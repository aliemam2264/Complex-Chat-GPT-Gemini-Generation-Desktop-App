import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "@eskander/database";

import { getStorageRoot } from "../config/storage";
import { imageJobManager } from "../services/background-job-manager";
import { getEffectivePromptPreset } from "../services/prompt-preset-settings";
import { chatGPTPromptProvider, runGeminiJob } from "./generation.controller";

type SessionParams = {
  projectId: string;
  sessionId: string;
};

function parseStringArray(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item !== "string") return [];
      try {
        const parsed = JSON.parse(item);
        return Array.isArray(parsed) ? parsed : [item];
      } catch {
        return [item];
      }
    });
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch {
      return [value];
    }
  }

  return value;
}

const stringIdArray = z.preprocess(
  parseStringArray,
  z.array(z.string().trim().min(1)).max(5),
);

const flowPromptSchema = z.object({
  sourceAssetId: z.string().min(1, "Source asset is required."),
  instruction: z.string().trim().min(1, "Instruction is required.").max(3000),
  preserveMode: z.enum(["STRICT", "BALANCED", "CREATIVE", "NO_RESTRICTION"]),
  preserveEverythingElse: z.preprocess((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean()),
  includeReferencesInAssistant: z.preprocess((value) => {
    if (value === undefined || value === "") return false;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean().default(false)),
  referenceAssetIds: stringIdArray.optional().default([]),
  referenceImageIds: stringIdArray.optional().default([]),
});

const flowGenerationSchema = flowPromptSchema.extend({
  refinedPrompt: z.string().trim().min(10, "Refined prompt is required.").max(12000),
});

const referenceExtensionByMimeType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

type ReferenceDescriptor = {
  filePath: string;
  fileName: string;
  mimeType: string;
};

async function getSessionSourceAsset(projectId: string, sessionId: string, sourceAssetId: string) {
  return prisma.asset.findFirst({
    where: {
      id: sourceAssetId,
      imageSessionId: sessionId,
      imageSession: {
        projectId,
      },
    },
  });
}

async function resolveStoredReferences(
  projectId: string,
  sessionId: string,
  referenceAssetIds: string[],
  referenceImageIds: string[],
): Promise<ReferenceDescriptor[]> {
  const uniqueAssetIds = [...new Set(referenceAssetIds)].slice(0, 5);
  const remainingSlots = Math.max(0, 5 - uniqueAssetIds.length);
  const uniqueReferenceImageIds = [...new Set(referenceImageIds)].slice(0, remainingSlots);

  const [assets, historicalReferences] = await Promise.all([
    uniqueAssetIds.length
      ? prisma.asset.findMany({
          where: {
            id: { in: uniqueAssetIds },
            imageSessionId: sessionId,
            imageSession: { projectId },
          },
        })
      : Promise.resolve([]),
    uniqueReferenceImageIds.length
      ? prisma.generationReferenceImage.findMany({
          where: {
            id: { in: uniqueReferenceImageIds },
            generationRun: {
              imageSessionId: sessionId,
              projectId,
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const referenceById = new Map(historicalReferences.map((reference) => [reference.id, reference]));

  const resolved: ReferenceDescriptor[] = [];

  for (const id of uniqueAssetIds) {
    const asset = assetById.get(id);
    if (!asset) continue;
    resolved.push({
      filePath: asset.filePath,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
    });
  }

  for (const id of uniqueReferenceImageIds) {
    const reference = referenceById.get(id);
    if (!reference) continue;
    resolved.push({
      filePath: reference.filePath,
      fileName: reference.fileName,
      mimeType: reference.mimeType,
    });
  }

  return resolved.slice(0, 5);
}

/**
 * Runs only the ChatGPT/LLM stage used by the Magnific-style flow editor.
 *
 * By default reference images are NOT sent to ChatGPT. They are visual
 * constraints for Gemini and should stay visual instead of being flattened
 * into prose. The Assistant node can explicitly enable reference analysis when
 * the user wants ChatGPT to reason about them as part of the prompt.
 */
export async function refineFlowPrompt(request: Request<SessionParams>, response: Response) {
  const { projectId, sessionId } = request.params;
  const legacyReferenceFiles = (request.files as Express.Multer.File[] | undefined) ?? [];

  if (legacyReferenceFiles.length > 5) {
    return response.status(422).json({
      success: false,
      message: "You can attach up to 5 reference images.",
    });
  }

  const parsed = flowPromptSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(422).json({
      success: false,
      message: "Invalid assistant request.",
      errors: parsed.error.flatten(),
    });
  }

  const sourceAsset = await getSessionSourceAsset(projectId, sessionId, parsed.data.sourceAssetId);

  if (!sourceAsset) {
    return response.status(404).json({
      success: false,
      message: "Source image not found.",
    });
  }

  const temporaryDirectory = join(getStorageRoot(), "flow-temp", randomUUID());
  const temporaryLegacyReferences: Array<{ path: string; fileName: string; mimeType: string }> = [];
  const abortController = new AbortController();

  const abortIfRequestCloses = () => {
    if (!response.writableEnded) abortController.abort();
  };

  request.once("aborted", abortIfRequestCloses);
  response.once("close", abortIfRequestCloses);

  try {
    const storedReferences = parsed.data.includeReferencesInAssistant
      ? await resolveStoredReferences(
          projectId,
          sessionId,
          parsed.data.referenceAssetIds,
          parsed.data.referenceImageIds,
        )
      : [];

    if (parsed.data.includeReferencesInAssistant && legacyReferenceFiles.length > 0) {
      await mkdir(temporaryDirectory, { recursive: true });

      for (let index = 0; index < legacyReferenceFiles.length && storedReferences.length + temporaryLegacyReferences.length < 5; index += 1) {
        const file = legacyReferenceFiles[index];
        if (!file) continue;
        const extension = referenceExtensionByMimeType[file.mimetype] ?? ".png";
        const absolutePath = join(temporaryDirectory, `reference-${index + 1}-${randomUUID()}${extension}`);
        await writeFile(absolutePath, file.buffer);
        temporaryLegacyReferences.push({
          path: absolutePath,
          fileName: file.originalname,
          mimeType: file.mimetype,
        });
      }
    }

    const preservePresetPrompt = await getEffectivePromptPreset(parsed.data.preserveMode);
    const storageRoot = getStorageRoot();

    const refinedPrompt = await chatGPTPromptProvider.generate({
      instruction: parsed.data.instruction,
      preserveMode: parsed.data.preserveMode,
      preserveEverythingElse:
        parsed.data.preserveMode === "NO_RESTRICTION" ? false : parsed.data.preserveEverythingElse,
      preservePresetPrompt,
      sourceImagePath: join(storageRoot, sourceAsset.filePath),
      sourceMimeType: sourceAsset.mimeType,
      referenceImages: [
        ...storedReferences.map((reference) => ({
          path: join(storageRoot, reference.filePath),
          fileName: reference.fileName,
          mimeType: reference.mimeType,
        })),
        ...temporaryLegacyReferences,
      ].slice(0, 5),
      signal: abortController.signal,
    });

    if (!refinedPrompt.trim()) {
      return response.status(502).json({
        success: false,
        message: "ChatGPT returned an empty prompt.",
      });
    }

    return response.json({
      success: true,
      data: {
        prompt: refinedPrompt.trim(),
      },
    });
  } catch (error) {
    if (abortController.signal.aborted) return;

    console.error("[FlowAssistant] Prompt refinement failed:", error);

    return response.status(502).json({
      success: false,
      message: error instanceof Error ? error.message : "ChatGPT prompt refinement failed.",
    });
  } finally {
    request.off("aborted", abortIfRequestCloses);
    response.off("close", abortIfRequestCloses);

    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
}

export async function uploadFlowImage(request: Request<SessionParams>, response: Response) {
  const { projectId, sessionId } = request.params;
  const file = request.file;

  if (!file) {
    return response.status(422).json({
      success: false,
      message: "Image file is required.",
    });
  }

  const session = await prisma.imageSession.findFirst({
    where: {
      id: sessionId,
      projectId,
    },
    select: { id: true },
  });

  if (!session) {
    return response.status(404).json({
      success: false,
      message: "Render session not found.",
    });
  }

  const assetId = randomUUID();
  const extension = referenceExtensionByMimeType[file.mimetype] ?? ".png";
  const storedFileName = `flow-${assetId}${extension}`;
  const relativeFilePath = ["projects", projectId, sessionId, "flow-inputs", storedFileName].join("/");
  const absoluteFilePath = join(getStorageRoot(), relativeFilePath);

  try {
    await mkdir(dirname(absoluteFilePath), { recursive: true });
    await writeFile(absoluteFilePath, file.buffer);

    const asset = await prisma.asset.create({
      data: {
        id: assetId,
        imageSessionId: sessionId,
        type: "FLOW_INPUT",
        parentAssetId: null,
        filePath: relativeFilePath,
        fileName: file.originalname,
        mimeType: file.mimetype,
      },
    });

    return response.status(201).json({
      success: true,
      data: asset,
    });
  } catch (error) {
    await rm(absoluteFilePath, { force: true }).catch(() => undefined);
    console.error("[FlowImage] Could not save flow input:", error);

    return response.status(500).json({
      success: false,
      message: "Could not save flow image.",
    });
  }
}

/**
 * Creates a normal GenerationRun from an already-refined Assistant prompt and
 * starts only the Gemini image stage. Stored flow-image asset ids are resolved
 * directly on the API so the renderer never has to fetch an image and upload
 * it again (which also avoids cross-origin/blob failures in Electron).
 */
export async function createFlowImageGeneration(request: Request<SessionParams>, response: Response) {
  const { projectId, sessionId } = request.params;
  const legacyReferenceFiles = (request.files as Express.Multer.File[] | undefined) ?? [];

  if (legacyReferenceFiles.length > 5) {
    return response.status(422).json({
      success: false,
      message: "You can attach up to 5 reference images.",
    });
  }

  const parsed = flowGenerationSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(422).json({
      success: false,
      message: "Invalid image generation request.",
      errors: parsed.error.flatten(),
    });
  }

  const sourceAsset = await getSessionSourceAsset(projectId, sessionId, parsed.data.sourceAssetId);

  if (!sourceAsset) {
    return response.status(404).json({
      success: false,
      message: "Source image not found.",
    });
  }

  const storedReferences = await resolveStoredReferences(
    projectId,
    sessionId,
    parsed.data.referenceAssetIds,
    parsed.data.referenceImageIds,
  );

  if (
    parsed.data.referenceAssetIds.length + parsed.data.referenceImageIds.length > 0 &&
    storedReferences.length === 0 &&
    legacyReferenceFiles.length === 0
  ) {
    return response.status(422).json({
      success: false,
      message: "The connected reference images could not be resolved. Reconnect them and try again.",
    });
  }

  const now = new Date();

  const generation = await prisma.generationRun.create({
    data: {
      projectId,
      imageSessionId: sessionId,
      sourceAssetId: sourceAsset.id,
      userInstruction: parsed.data.instruction,
      refinedPrompt: parsed.data.refinedPrompt,
      preserveMode: parsed.data.preserveMode,
      preserveEverythingElse:
        parsed.data.preserveMode === "NO_RESTRICTION" ? false : parsed.data.preserveEverythingElse,
      promptRevision: 1,
      promptProvider: "CHATGPT_BROWSER",
      imageProvider: "GEMINI_BROWSER",
      status: "PROMPT_READY",
      progressStage: "PROMPT_READY",
      progressMessage: "Prompt ready. Queuing Gemini...",
      errorMessage: null,
      attemptCount: 1,
      lastAttemptAt: now,
      startedAt: now,
    },
  });

  const writtenLegacyReferencePaths: string[] = [];

  try {
    let sortOrder = 0;

    for (const reference of storedReferences) {
      await prisma.generationReferenceImage.create({
        data: {
          id: randomUUID(),
          generationRunId: generation.id,
          filePath: reference.filePath,
          fileName: reference.fileName,
          mimeType: reference.mimeType,
          sortOrder,
        },
      });
      sortOrder += 1;
    }

    for (let index = 0; index < legacyReferenceFiles.length && sortOrder < 5; index += 1) {
      const file = legacyReferenceFiles[index];
      if (!file) continue;

      const referenceId = randomUUID();
      const extension = referenceExtensionByMimeType[file.mimetype] ?? ".png";
      const storedFileName = `reference-${referenceId}${extension}`;
      const relativeFilePath = ["projects", projectId, sessionId, "references", generation.id, storedFileName].join("/");
      const absoluteFilePath = join(getStorageRoot(), relativeFilePath);

      await mkdir(dirname(absoluteFilePath), { recursive: true });
      await writeFile(absoluteFilePath, file.buffer);
      writtenLegacyReferencePaths.push(absoluteFilePath);

      await prisma.generationReferenceImage.create({
        data: {
          id: referenceId,
          generationRunId: generation.id,
          filePath: relativeFilePath,
          fileName: file.originalname,
          mimeType: file.mimetype,
          sortOrder,
        },
      });
      sortOrder += 1;
    }
  } catch (error) {
    await Promise.all(
      writtenLegacyReferencePaths.map((filePath) => rm(filePath, { force: true }).catch(() => undefined)),
    );

    await prisma.generationRun.delete({ where: { id: generation.id } }).catch(() => undefined);

    console.error(`[FlowGenerator] Failed to save reference images for ${generation.id}:`, error);

    return response.status(500).json({
      success: false,
      message: "Failed to prepare reference images.",
    });
  }

  const queued = imageJobManager.enqueue(generation.id, (signal) => runGeminiJob(generation.id, signal));

  if (!queued) {
    await prisma.generationRun.update({
      where: { id: generation.id },
      data: {
        status: "FAILED",
        progressStage: "FAILED",
        progressMessage: "Gemini job could not be queued.",
        errorMessage: "Gemini job could not be queued.",
      },
    });

    return response.status(409).json({
      success: false,
      message: "Gemini job could not be queued. Try again.",
    });
  }

  const generationWithReferences = await prisma.generationRun.findUnique({
    where: { id: generation.id },
    include: {
      sourceAsset: true,
      outputAsset: true,
      referenceImages: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return response.status(202).json({
    success: true,
    data: generationWithReferences,
  });
}
