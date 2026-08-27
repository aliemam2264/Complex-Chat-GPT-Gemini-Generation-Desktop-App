import { rm } from "node:fs/promises";
import { join, relative } from "node:path";

import type { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "@eskander/database";
import {
  ChatGPTBrowserPromptProvider,
  ChatGPTLoginRequiredError,
  GeminiBrowserImageProvider,
  GeminiLoginRequiredError,
} from "@eskander/providers";

import { getStorageRoot } from "../config/storage";
import { imageJobManager, promptJobManager } from "../services/background-job-manager";

type GenerationParams = {
  generationId: string;
};

type SessionParams = {
  projectId: string;
  sessionId: string;
};

const chatGPTPromptProvider = new ChatGPTBrowserPromptProvider({
  userDataDirectory: join(getStorageRoot(), "browser-profiles", "chatgpt"),
});

const geminiProvider = new GeminiBrowserImageProvider({
  userDataDirectory: join(getStorageRoot(), "browser-profiles", "gemini"),
});

const createPromptSchema = z.object({
  sourceAssetId: z.string().min(1, "Source asset is required."),

  instruction: z.string().trim().min(1, "Instruction is required.").max(3000),

  preserveMode: z.enum(["STRICT", "BALANCED", "CREATIVE"]),

  preserveEverythingElse: z.boolean(),
});

const updatePromptSchema = z.object({
  prompt: z.string().trim().min(10).max(12000),
});

const ACTIVE_GENERATION_STATUSES = ["PENDING", "PROMPTING", "PROMPT_READY", "GENERATING", "DOWNLOADING"] as const;

async function markGenerationCanceled(generationId: string) {
  const now = new Date();

  await prisma.generationRun.updateMany({
    where: {
      id: generationId,
      status: {
        not: "COMPLETED",
      },
    },
    data: {
      status: "CANCELED",
      progressStage: "CANCELED",
      progressMessage: "Generation canceled.",
      errorMessage: null,
      cancelRequestedAt: now,
      canceledAt: now,
    },
  });
}

/* -------------------------------------------------------------------------- */
/*                                Create Prompt                               */
/* -------------------------------------------------------------------------- */

export async function createPrompt(request: Request<SessionParams>, response: Response) {
  const { projectId, sessionId } = request.params;

  const parsed = createPromptSchema.safeParse(request.body);

  if (!parsed.success) {
    console.log("Invalid prompt body:", request.body);
    console.log("Prompt validation errors:", parsed.error.flatten());

    return response.status(422).json({
      success: false,
      message: "Invalid prompt request.",
      errors: parsed.error.flatten(),
    });
  }

  const { sourceAssetId, instruction, preserveMode, preserveEverythingElse } = parsed.data;

  const sourceAsset = await prisma.asset.findFirst({
    where: {
      id: sourceAssetId,
      imageSessionId: sessionId,
      imageSession: {
        projectId,
      },
    },
  });

  if (!sourceAsset) {
    return response.status(404).json({
      success: false,
      message: "Source image not found.",
    });
  }

  const generation = await prisma.generationRun.create({
    data: {
      projectId,
      imageSessionId: sessionId,
      sourceAssetId: sourceAsset.id,
      userInstruction: instruction,
      preserveMode,
      preserveEverythingElse,
      promptProvider: "CHATGPT_BROWSER",
      status: "PENDING",
      progressStage: "CHATGPT_STARTING",
      progressMessage: "Starting ChatGPT...",
      attemptCount: 1,
      lastAttemptAt: new Date(),
      errorMessage: null,
    },
  });

  promptJobManager.enqueue(generation.id, (signal) => runPromptJob(generation.id, signal));

  return response.status(202).json({
    success: true,
    data: generation,
  });
}

/* -------------------------------------------------------------------------- */
/*                              Regenerate Prompt                             */
/* -------------------------------------------------------------------------- */

export async function regeneratePrompt(request: Request<GenerationParams>, response: Response) {
  const { generationId } = request.params;

  const generation = await prisma.generationRun.findUnique({
    where: { id: generationId },
  });

  if (!generation) {
    return response.status(404).json({
      success: false,
      message: "Generation not found.",
    });
  }

  if (ACTIVE_GENERATION_STATUSES.includes(generation.status as (typeof ACTIVE_GENERATION_STATUSES)[number])) {
    return response.status(409).json({
      success: false,
      message: "This generation is currently running.",
    });
  }

  if (generation.status === "COMPLETED" || generation.outputAssetId) {
    return response.status(409).json({
      success: false,
      message: "Completed generations cannot be regenerated.",
    });
  }

  if (generation.imageProvider === "GEMINI_BROWSER" && generation.refinedPrompt?.trim()) {
    return response.status(409).json({
      success: false,
      message: "Use Retry to retry the image generation without rebuilding the prompt.",
    });
  }

  const updated = await prisma.generationRun.update({
    where: { id: generation.id },
    data: {
      refinedPrompt: null,
      status: "PENDING",
      progressStage: "CHATGPT_STARTING",
      progressMessage: "Starting ChatGPT...",
      imageProvider: null,
      errorMessage: null,
      completedAt: null,
      cancelRequestedAt: null,
      canceledAt: null,
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });

  promptJobManager.enqueue(generation.id, (signal) => runPromptJob(generation.id, signal));

  return response.status(202).json({
    success: true,
    data: updated,
  });
}

/* -------------------------------------------------------------------------- */
/*                                Update Prompt                               */
/* -------------------------------------------------------------------------- */

export async function updatePrompt(request: Request<GenerationParams>, response: Response) {
  const { generationId } = request.params;

  const parsed = updatePromptSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(422).json({
      success: false,
      message: "Invalid prompt.",
      errors: parsed.error.flatten(),
    });
  }

  const generation = await prisma.generationRun.findUnique({
    where: {
      id: generationId,
    },
  });

  if (!generation) {
    return response.status(404).json({
      success: false,
      message: "Generation not found.",
    });
  }

  /*
   * Manual prompt editing is only allowed
   * while the prompt is ready for review.
   */
  if (generation.status !== "PROMPT_READY") {
    return response.status(409).json({
      success: false,
      message: "The prompt cannot be edited in its current state.",
    });
  }

  const updated = await prisma.generationRun.update({
    where: {
      id: generation.id,
    },

    data: {
      refinedPrompt: parsed.data.prompt,

      progressStage: "PROMPT_READY",
      progressMessage: "Prompt ready.",

      errorMessage: null,
    },
  });

  return response.json({
    success: true,
    data: updated,
  });
}

/* -------------------------------------------------------------------------- */
/*                             Get Generation Status                          */
/* -------------------------------------------------------------------------- */

export async function getGeneration(request: Request<GenerationParams>, response: Response) {
  const { generationId } = request.params;

  const generation = await prisma.generationRun.findUnique({
    where: {
      id: generationId,
    },

    include: {
      sourceAsset: true,
      outputAsset: true,
    },
  });

  if (!generation) {
    return response.status(404).json({
      success: false,
      message: "Generation not found.",
    });
  }

  return response.json({
    success: true,
    data: generation,
  });
}

export async function getGenerationHistory(request: Request<SessionParams>, response: Response) {
  const { projectId, sessionId } = request.params;

  const session = await prisma.imageSession.findFirst({
    where: {
      id: sessionId,
      projectId,
    },
    select: {
      id: true,
    },
  });

  if (!session) {
    return response.status(404).json({
      success: false,
      message: "Render session not found.",
    });
  }

  const generations = await prisma.generationRun.findMany({
    where: {
      projectId,
      imageSessionId: sessionId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 100,
    include: {
      sourceAsset: true,
      outputAsset: true,
    },
  });

  return response.json({
    success: true,
    data: generations,
  });
}

export async function getGenerationActivity(request: Request, response: Response) {
  const ids =
    typeof request.query.ids === "string"
      ? request.query.ids
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];

  const recentThreshold = new Date(Date.now() - 30_000);

  const generations = await prisma.generationRun.findMany({
    where: {
      OR: [
        {
          id: { in: ids },
          status: {
            in: [
              "PENDING",
              "PROMPTING",
              "PROMPT_READY",
              "GENERATING",
              "DOWNLOADING",
              "COMPLETED",
              "FAILED",
              "CANCELED",
            ],
          },
        },
        {
          status: {
            in: ["GENERATING", "DOWNLOADING"],
          },
        },
        {
          status: {
            in: ["COMPLETED", "CANCELED"],
          },
          updatedAt: { gte: recentThreshold },
        },
        {
          status: "FAILED",
          OR: [{ imageProvider: "GEMINI_BROWSER" }, { progressStage: "INTERRUPTED" }],
          updatedAt: { gte: recentThreshold },
        },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    include: {
      project: {
        select: { id: true, name: true },
      },
      imageSession: {
        select: { id: true, name: true },
      },
      outputAsset: {
        select: { id: true, filePath: true, fileName: true },
      },
    },
  });

  return response.json({
    success: true,
    data: generations,
  });
}

/* -------------------------------------------------------------------------- */
/*                          Cancel / Retry Generation                         */
/* -------------------------------------------------------------------------- */

export async function cancelGeneration(request: Request<GenerationParams>, response: Response) {
  const { generationId } = request.params;

  const generation = await prisma.generationRun.findUnique({
    where: { id: generationId },
  });

  if (!generation) {
    return response.status(404).json({
      success: false,
      message: "Generation not found.",
    });
  }

  if (generation.status === "COMPLETED") {
    return response.status(409).json({
      success: false,
      message: "Completed generations cannot be canceled.",
    });
  }

  if (generation.status === "CANCELED") {
    return response.json({
      success: true,
      data: generation,
    });
  }

  if (generation.status === "FAILED") {
    return response.status(409).json({
      success: false,
      message: "This generation has already stopped. Use Retry to run it again.",
    });
  }

  promptJobManager.cancel(generation.id);
  imageJobManager.cancel(generation.id);

  await Promise.all([promptJobManager.waitForIdle(generation.id), imageJobManager.waitForIdle(generation.id)]);

  const now = new Date();

  const canceled = await prisma.generationRun.updateMany({
    where: {
      id: generation.id,
      status: {
        in: [...ACTIVE_GENERATION_STATUSES],
      },
    },
    data: {
      status: "CANCELED",
      progressStage: "CANCELED",
      progressMessage: "Generation canceled.",
      errorMessage: null,
      cancelRequestedAt: now,
      canceledAt: now,
    },
  });

  if (canceled.count === 0) {
    const current = await prisma.generationRun.findUnique({
      where: { id: generation.id },
    });

    if (!current) {
      return response.status(404).json({
        success: false,
        message: "Generation not found.",
      });
    }

    return response.json({
      success: true,
      data: current,
    });
  }

  const updated = await prisma.generationRun.findUniqueOrThrow({
    where: { id: generation.id },
  });

  return response.json({
    success: true,
    data: updated,
  });
}

export async function retryGeneration(request: Request<GenerationParams>, response: Response) {
  const { generationId } = request.params;

  const generation = await prisma.generationRun.findUnique({
    where: { id: generationId },
  });

  if (!generation) {
    return response.status(404).json({
      success: false,
      message: "Generation not found.",
    });
  }

  if (promptJobManager.isRunning(generation.id) || imageJobManager.isRunning(generation.id)) {
    return response.status(409).json({
      success: false,
      message: "The previous generation attempt is still shutting down. Try again in a moment.",
    });
  }

  if (generation.status !== "FAILED" && generation.status !== "CANCELED") {
    return response.status(409).json({
      success: false,
      message: "Only failed or canceled generations can be retried.",
    });
  }

  if (generation.outputAssetId) {
    return response.status(409).json({
      success: false,
      message: "This generation already has an output image.",
    });
  }

  const retryGemini = Boolean(generation.refinedPrompt?.trim());

  if (retryGemini) {
    const updated = await prisma.generationRun.update({
      where: { id: generation.id },
      data: {
        status: "GENERATING",
        imageProvider: "GEMINI_BROWSER",
        progressStage: "GEMINI_STARTING",
        progressMessage: "Retrying image generation...",
        errorMessage: null,
        completedAt: null,
        cancelRequestedAt: null,
        canceledAt: null,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });

    imageJobManager.enqueue(generation.id, (signal) => runGeminiJob(generation.id, signal));

    return response.status(202).json({
      success: true,
      data: updated,
    });
  }

  const updated = await prisma.generationRun.update({
    where: { id: generation.id },
    data: {
      refinedPrompt: null,
      status: "PENDING",
      promptProvider: "CHATGPT_BROWSER",
      imageProvider: null,
      progressStage: "CHATGPT_STARTING",
      progressMessage: "Retrying prompt generation...",
      errorMessage: null,
      completedAt: null,
      cancelRequestedAt: null,
      canceledAt: null,
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });

  promptJobManager.enqueue(generation.id, (signal) => runPromptJob(generation.id, signal));

  return response.status(202).json({
    success: true,
    data: updated,
  });
}

/* -------------------------------------------------------------------------- */
/*                              Nano Banana                                   */
/* -------------------------------------------------------------------------- */

export async function sendToNanoBanana(request: Request<GenerationParams>, response: Response) {
  const { generationId } = request.params;

  const generation = await prisma.generationRun.findUnique({
    where: { id: generationId },
  });

  if (!generation) {
    return response.status(404).json({
      success: false,
      message: "Generation not found.",
    });
  }

  if (generation.status !== "PROMPT_READY") {
    return response.status(409).json({
      success: false,
      message: "Prompt must be ready before starting image generation.",
    });
  }

  if (!generation.refinedPrompt?.trim()) {
    return response.status(422).json({
      success: false,
      message: "Prompt is not ready.",
    });
  }

  if (generation.outputAssetId) {
    return response.status(409).json({
      success: false,
      message: "This generation already has an output image.",
    });
  }

  const updated = await prisma.generationRun.update({
    where: { id: generation.id },
    data: {
      status: "GENERATING",
      imageProvider: "GEMINI_BROWSER",
      progressStage: "GEMINI_STARTING",
      progressMessage: "Starting Gemini...",
      errorMessage: null,
      cancelRequestedAt: null,
      canceledAt: null,
    },
  });

  imageJobManager.enqueue(generation.id, (signal) => runGeminiJob(generation.id, signal));

  return response.status(202).json({
    success: true,
    data: updated,
  });
}

/* -------------------------------------------------------------------------- */
/*                              Gemini Provider                               */
/* -------------------------------------------------------------------------- */

export async function connectGemini(_request: Request, response: Response) {
  try {
    await geminiProvider.openManualLogin();

    return response.json({
      success: true,

      data: {
        message: "Chrome opened. Sign in to Gemini, then close the Chrome window when finished.",
      },
    });
  } catch (error) {
    console.error("[Gemini] Could not open manual login:", error);

    return response.status(500).json({
      success: false,

      message: error instanceof Error ? error.message : "Could not open Chrome.",
    });
  }
}

export async function getGeminiStatus(_request: Request, response: Response) {
  const status = await geminiProvider.checkConnection();

  return response.json({
    success: true,
    data: status,
  });
}

/* -------------------------------------------------------------------------- */
/*                              ChatGPT Provider                              */
/* -------------------------------------------------------------------------- */

export async function connectChatGPT(_request: Request, response: Response) {
  try {
    await chatGPTPromptProvider.openManualLogin();

    return response.json({
      success: true,

      data: {
        message: "Chrome opened. Sign in to ChatGPT, then close Chrome and check the connection.",
      },
    });
  } catch (error) {
    console.error("[ChatGPT] Could not open manual login:", error);

    return response.status(500).json({
      success: false,

      message: error instanceof Error ? error.message : "Could not open ChatGPT.",
    });
  }
}

export async function getChatGPTStatus(_request: Request, response: Response) {
  const status = await chatGPTPromptProvider.checkConnection();

  return response.json({
    success: true,
    data: status,
  });
}

/* -------------------------------------------------------------------------- */
/*                            Prompt Background Job                           */
/* -------------------------------------------------------------------------- */
async function runPromptJob(generationId: string, signal: AbortSignal) {
  const generation = await prisma.generationRun.findUnique({
    where: { id: generationId },
    include: { sourceAsset: true },
  });

  if (!generation) {
    console.error(`[PromptJob] Generation ${generationId} not found.`);
    return;
  }

  try {
    if (signal.aborted) {
      await markGenerationCanceled(generation.id);
      return;
    }

    await prisma.generationRun.updateMany({
      where: {
        id: generation.id,
        status: { in: ["PENDING", "PROMPTING"] },
      },
      data: {
        status: "PROMPTING",
        promptProvider: "CHATGPT_BROWSER",
        imageProvider: null,
        progressStage: "CHATGPT_STARTING",
        progressMessage: "Preparing ChatGPT...",
        startedAt: generation.startedAt ?? new Date(),
        lastAttemptAt: generation.lastAttemptAt ?? new Date(),
        errorMessage: null,
      },
    });

    if (signal.aborted) {
      await markGenerationCanceled(generation.id);
      return;
    }

    const refinedPrompt = await chatGPTPromptProvider.generate({
      instruction: generation.userInstruction,
      preserveMode: generation.preserveMode,
      preserveEverythingElse: generation.preserveEverythingElse,
      sourceImagePath: join(getStorageRoot(), generation.sourceAsset.filePath),
      sourceMimeType: generation.sourceAsset.mimeType,
      signal,
      onProgress: async ({ stage, message }) => {
        if (signal.aborted) {
          return;
        }

        await prisma.generationRun.updateMany({
          where: {
            id: generation.id,
            status: "PROMPTING",
          },
          data: {
            progressStage: stage,
            progressMessage: message,
            errorMessage: null,
          },
        });
      },
    });

    if (signal.aborted) {
      await markGenerationCanceled(generation.id);
      return;
    }

    if (!refinedPrompt.trim()) {
      throw new Error("ChatGPT returned an empty prompt.");
    }

    const handoff = await prisma.generationRun.updateMany({
      where: {
        id: generation.id,
        status: "PROMPTING",
      },
      data: {
        refinedPrompt,
        promptProvider: "CHATGPT_BROWSER",
        promptRevision: { increment: 1 },
        status: "GENERATING",
        imageProvider: "GEMINI_BROWSER",
        progressStage: "GEMINI_STARTING",
        progressMessage: "Prompt ready. Starting Gemini...",
        errorMessage: null,
      },
    });

    if (handoff.count === 0 || signal.aborted) {
      if (signal.aborted) {
        await markGenerationCanceled(generation.id);
      }

      return;
    }

    imageJobManager.enqueue(generation.id, (imageSignal) => runGeminiJob(generation.id, imageSignal));

    console.log(`[PromptJob] ${generation.id} started Gemini.`);
  } catch (error) {
    if (signal.aborted) {
      await markGenerationCanceled(generation.id);
      return;
    }

    if (error instanceof ChatGPTLoginRequiredError) {
      await prisma.generationRun.updateMany({
        where: {
          id: generation.id,
          status: { not: "CANCELED" },
        },
        data: {
          status: "FAILED",
          imageProvider: null,
          progressStage: "CHATGPT_LOGIN_REQUIRED",
          progressMessage: error.message,
          errorMessage: error.message,
        },
      });

      return;
    }

    console.error(`[PromptJob] ${generation.id} failed:`, error);

    const message = error instanceof Error ? error.message : "Prompt generation failed.";

    await prisma.generationRun.updateMany({
      where: {
        id: generation.id,
        status: { not: "CANCELED" },
      },
      data: {
        status: "FAILED",
        imageProvider: null,
        progressStage: "FAILED",
        progressMessage: message,
        errorMessage: message,
      },
    });
  }
}

async function runGeminiJob(generationId: string, signal: AbortSignal) {
  const generation = await prisma.generationRun.findUnique({
    where: { id: generationId },
    include: { sourceAsset: true },
  });

  if (!generation) {
    console.error(`[GeminiJob] Generation ${generationId} not found.`);
    return;
  }

  if (generation.outputAssetId) {
    console.warn(`[GeminiJob] ${generation.id} already has an output asset.`);
    return;
  }

  if (!generation.refinedPrompt?.trim()) {
    await prisma.generationRun.updateMany({
      where: { id: generation.id, status: { not: "CANCELED" } },
      data: {
        status: "FAILED",
        progressStage: "FAILED",
        progressMessage: "Prompt is not ready.",
        errorMessage: "Prompt is not ready.",
      },
    });

    return;
  }

  const storageRoot = getStorageRoot();
  const sourceImagePath = join(storageRoot, generation.sourceAsset.filePath);
  const outputDirectory = join(storageRoot, "projects", generation.projectId, generation.imageSessionId);

  let downloadedPath: string | null = null;

  try {
    if (signal.aborted) {
      await markGenerationCanceled(generation.id);
      return;
    }

    await prisma.generationRun.updateMany({
      where: {
        id: generation.id,
        status: { in: ["GENERATING", "PROMPT_READY"] },
      },
      data: {
        status: "GENERATING",
        imageProvider: "GEMINI_BROWSER",
        progressStage: "GEMINI_STARTING",
        progressMessage: "Preparing Gemini...",
        errorMessage: null,
      },
    });

    let result: Awaited<ReturnType<typeof geminiProvider.generate>> | null = null;
    let lastError: unknown = null;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) {
        await markGenerationCanceled(generation.id);
        return;
      }

      try {
        await prisma.generationRun.updateMany({
          where: { id: generation.id, status: "GENERATING" },
          data: {
            progressStage: "GEMINI_GENERATING",
            progressMessage: attempt === 1 ? "Gemini is editing your render..." : "Retrying Gemini generation...",
            errorMessage: null,
          },
        });

        result = await geminiProvider.generate({
          sourceImagePath,
          outputDirectory,
          prompt: generation.refinedPrompt,
          signal,
        });

        break;
      } catch (error) {
        if (signal.aborted) {
          await markGenerationCanceled(generation.id);
          return;
        }

        if (error instanceof GeminiLoginRequiredError) {
          throw error;
        }

        lastError = error;
        console.warn(`[GeminiJob] ${generation.id} attempt ${attempt} failed:`, error);

        if (attempt < maxAttempts) {
          await prisma.generationRun.updateMany({
            where: { id: generation.id, status: "GENERATING" },
            data: {
              progressStage: "GEMINI_GENERATING",
              progressMessage: "Gemini encountered a temporary issue. Retrying...",
            },
          });

          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    if (!result) {
      throw lastError ?? new Error("Gemini generation failed.");
    }

    downloadedPath = result.absolutePath;

    if (signal.aborted) {
      await rm(result.absolutePath, { force: true }).catch(() => undefined);
      await markGenerationCanceled(generation.id);
      return;
    }

    const saving = await prisma.generationRun.updateMany({
      where: { id: generation.id, status: "GENERATING" },
      data: {
        status: "DOWNLOADING",
        progressStage: "SAVING_VERSION",
        progressMessage: "Saving generated version...",
        errorMessage: null,
      },
    });

    if (saving.count === 0 || signal.aborted) {
      await rm(result.absolutePath, { force: true }).catch(() => undefined);

      if (signal.aborted) {
        await markGenerationCanceled(generation.id);
      }

      return;
    }

    const relativeFilePath = relative(storageRoot, result.absolutePath).replaceAll("\\", "/");

    const completed = await prisma.$transaction(async (transaction) => {
      const current = await transaction.generationRun.findUnique({
        where: { id: generation.id },
        select: { status: true },
      });

      if (!current || current.status !== "DOWNLOADING") {
        throw new Error("GENERATION_NOT_ACTIVE");
      }

      const outputAsset = await transaction.asset.create({
        data: {
          imageSessionId: generation.imageSessionId,
          type: "GENERATED",
          parentAssetId: generation.sourceAssetId,
          filePath: relativeFilePath,
          fileName: result.fileName,
          mimeType: result.mimeType,
        },
      });

      const completedGeneration = await transaction.generationRun.update({
        where: { id: generation.id },
        data: {
          outputAssetId: outputAsset.id,
          status: "COMPLETED",
          progressStage: "DONE",
          progressMessage: "Generated version is ready.",
          completedAt: new Date(),
          canceledAt: null,
          cancelRequestedAt: null,
          errorMessage: null,
        },
      });

      return { generation: completedGeneration, asset: outputAsset };
    });

    downloadedPath = null;

    console.log(`[GeminiJob] ${generation.id} completed. Output asset: ${completed.asset.id}`);
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.message === "GENERATION_NOT_ACTIVE")) {
      if (downloadedPath) {
        await rm(downloadedPath, { force: true }).catch(() => undefined);
      }

      await markGenerationCanceled(generation.id);
      return;
    }

    if (error instanceof GeminiLoginRequiredError) {
      const message = "Gemini sign in is required. Reconnect Gemini from Settings and try again.";

      await prisma.generationRun.updateMany({
        where: { id: generation.id, status: { not: "CANCELED" } },
        data: {
          status: "FAILED",
          imageProvider: "GEMINI_BROWSER",
          progressStage: "GEMINI_LOGIN_REQUIRED",
          progressMessage: message,
          errorMessage: error.message,
        },
      });

      return;
    }

    console.error(`[GeminiJob] ${generation.id} failed after retries:`, error);

    if (downloadedPath) {
      await rm(downloadedPath, { force: true }).catch(() => undefined);
    }

    const message = error instanceof Error ? error.message : "Nano Banana generation failed.";

    await prisma.generationRun.updateMany({
      where: { id: generation.id, status: { not: "CANCELED" } },
      data: {
        status: "FAILED",
        imageProvider: "GEMINI_BROWSER",
        progressStage: "FAILED",
        progressMessage: message,
        errorMessage: message,
      },
    });
  }
}
