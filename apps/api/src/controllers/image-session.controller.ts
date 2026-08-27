import { randomUUID } from "node:crypto";
import { mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import type { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "@eskander/database";

import { getStorageRoot } from "../config/storage";

type ProjectParams = {
  projectId: string;
};

type SessionParams = {
  projectId: string;
  sessionId: string;
};

type UploadedRenderFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

type CreateImageSessionRequest = Request<ProjectParams> & {
  file?: UploadedRenderFile;
};

const extensionByMimeType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const ACTIVE_GENERATION_STATUSES = ["PENDING", "PROMPTING", "PROMPT_READY", "GENERATING", "DOWNLOADING"] as const;

function getSessionName(originalFileName: string) {
  const extension = extname(originalFileName);
  const cleanName = basename(originalFileName, extension).trim();

  return cleanName || `Render ${new Date().toLocaleDateString()}`;
}

export async function createImageSession(request: CreateImageSessionRequest, response: Response) {
  const { projectId } = request.params;
  const file = request.file;

  if (!file) {
    return response.status(422).json({
      success: false,
      message: "Image is required.",
    });
  }

  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
    select: {
      id: true,
    },
  });

  if (!project) {
    return response.status(404).json({
      success: false,
      message: "Project not found.",
    });
  }

  const imageSessionId = randomUUID();
  const assetId = randomUUID();
  const extension = extensionByMimeType[file.mimetype] ?? ".png";
  const storedFileName = `original-${assetId}${extension}`;
  const relativeFilePath = ["projects", projectId, imageSessionId, storedFileName].join("/");
  const absoluteFilePath = join(getStorageRoot(), relativeFilePath);

  try {
    await mkdir(dirname(absoluteFilePath), {
      recursive: true,
    });

    await writeFile(absoluteFilePath, file.buffer);

    const imageSession = await prisma.$transaction(async (transaction) => {
      const session = await transaction.imageSession.create({
        data: {
          id: imageSessionId,
          projectId,
          name: getSessionName(file.originalname),
        },
      });

      const asset = await transaction.asset.create({
        data: {
          id: assetId,
          imageSessionId: session.id,
          type: "ORIGINAL",
          parentAssetId: null,
          filePath: relativeFilePath,
          fileName: file.originalname,
          mimeType: file.mimetype,
        },
      });

      return {
        ...session,
        assets: [asset],
      };
    });

    return response.status(201).json({
      success: true,
      data: imageSession,
    });
  } catch (error) {
    await unlink(absoluteFilePath).catch(() => undefined);

    console.error("Failed to create image session:", error);

    return response.status(500).json({
      success: false,
      message: "Failed to upload render.",
    });
  }
}

export async function getImageSession(request: Request<SessionParams>, response: Response) {
  const { projectId, sessionId } = request.params;

  const session = await prisma.imageSession.findFirst({
    where: {
      id: sessionId,
      projectId,
    },
    include: {
      assets: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!session) {
    return response.status(404).json({
      success: false,
      message: "Render session not found.",
    });
  }

  return response.json({
    success: true,
    data: session,
  });
}

const deleteImageSessionsSchema = z.object({
  sessionIds: z.array(z.string().min(1)).min(1),
});

export async function deleteImageSessions(request: Request<ProjectParams>, response: Response) {
  const { projectId } = request.params;
  const parsed = deleteImageSessionsSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(422).json({
      success: false,
      message: "At least one render must be selected.",
    });
  }

  const sessionIds = Array.from(new Set(parsed.data.sessionIds));

  const sessions = await prisma.imageSession.findMany({
    where: {
      projectId,
      id: {
        in: sessionIds,
      },
    },
    select: {
      id: true,
    },
  });

  if (sessions.length === 0) {
    return response.status(404).json({
      success: false,
      message: "No matching renders found.",
    });
  }

  const validSessionIds = sessions.map((session) => session.id);

  await prisma.imageSession.deleteMany({
    where: {
      projectId,
      id: {
        in: validSessionIds,
      },
    },
  });

  await Promise.allSettled(
    validSessionIds.map((sessionId) =>
      rm(join(getStorageRoot(), "projects", projectId, sessionId), {
        recursive: true,
        force: true,
      }),
    ),
  );

  return response.json({
    success: true,
    data: {
      deletedCount: validSessionIds.length,
      deletedSessionIds: validSessionIds,
    },
  });
}

const deleteVersionsSchema = z.object({
  assetIds: z.array(z.string().min(1)).min(1),
});

/**
 * Delete only the explicitly selected GENERATED versions.
 *
 * Important behavior:
 * - ORIGINAL can never be deleted here.
 * - Unselected descendants are preserved.
 * - When a deleted version has surviving children, those children are
 *   re-parented to the closest surviving ancestor so the version chain
 *   remains usable instead of becoming orphaned.
 * - Any historical GenerationRun that directly references a deleted asset is
 *   removed, but its unselected output asset is preserved.
 * - A version cannot be deleted while an active generation is using it as its
 *   source.
 */
export async function deleteVersions(request: Request<SessionParams>, response: Response) {
  const { projectId, sessionId } = request.params;
  const parsed = deleteVersionsSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(422).json({
      success: false,
      message: "Select at least one generated version to delete.",
    });
  }

  const requestedAssetIds = Array.from(new Set(parsed.data.assetIds));

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

  const assets = await prisma.asset.findMany({
    where: {
      imageSessionId: sessionId,
      id: {
        in: requestedAssetIds,
      },
    },
    select: {
      id: true,
      type: true,
      parentAssetId: true,
      filePath: true,
    },
  });

  if (assets.length !== requestedAssetIds.length) {
    return response.status(404).json({
      success: false,
      message: "One or more selected versions could not be found.",
    });
  }

  const originalSelected = assets.some((asset) => asset.type === "ORIGINAL");

  if (originalSelected) {
    return response.status(422).json({
      success: false,
      message: "The original render cannot be deleted from Versions.",
    });
  }

  const validAssetIds = assets.map((asset) => asset.id);
  const validAssetIdSet = new Set(validAssetIds);

  const activeGeneration = await prisma.generationRun.findFirst({
    where: {
      imageSessionId: sessionId,
      sourceAssetId: {
        in: validAssetIds,
      },
      status: {
        in: [...ACTIVE_GENERATION_STATUSES],
      },
    },
    select: {
      id: true,
      sourceAssetId: true,
      status: true,
    },
  });

  if (activeGeneration) {
    return response.status(409).json({
      success: false,
      message:
        "One of the selected versions is currently being used by an active generation. Cancel it or wait for it to finish, then delete the version.",
      data: {
        generationId: activeGeneration.id,
        blockedAssetId: activeGeneration.sourceAssetId,
      },
    });
  }

  const selectedAssetById = new Map(assets.map((asset) => [asset.id, asset] as const));

  function getClosestSurvivingParentId(assetId: string) {
    const visited = new Set<string>();
    let parentAssetId = selectedAssetById.get(assetId)?.parentAssetId ?? null;

    while (parentAssetId && validAssetIdSet.has(parentAssetId)) {
      if (visited.has(parentAssetId)) {
        return null;
      }

      visited.add(parentAssetId);
      parentAssetId = selectedAssetById.get(parentAssetId)?.parentAssetId ?? null;
    }

    return parentAssetId;
  }

  try {
    await prisma.$transaction(async (transaction) => {
      /*
       * Preserve every unselected descendant.
       *
       * Example:
       * Original -> V1 (delete) -> V2 (keep)
       * becomes:
       * Original -> V2
       */
      for (const asset of assets) {
        const survivingParentAssetId = getClosestSurvivingParentId(asset.id);

        await transaction.asset.updateMany({
          where: {
            imageSessionId: sessionId,
            parentAssetId: asset.id,
            id: {
              notIn: validAssetIds,
            },
          },
          data: {
            parentAssetId: survivingParentAssetId,
          },
        });
      }

      /*
       * GenerationRun.sourceAssetId is a required relation, so generation
       * history that points directly at a deleted version must be removed
       * before deleting the asset. This does NOT delete an unselected output
       * Asset produced by that historical run.
       */
      await transaction.generationRun.deleteMany({
        where: {
          OR: [
            {
              sourceAssetId: {
                in: validAssetIds,
              },
            },
            {
              outputAssetId: {
                in: validAssetIds,
              },
            },
          ],
        },
      });

      const deleted = await transaction.asset.deleteMany({
        where: {
          imageSessionId: sessionId,
          type: "GENERATED",
          id: {
            in: validAssetIds,
          },
        },
      });

      if (deleted.count !== validAssetIds.length) {
        throw new Error("Not all selected versions could be deleted.");
      }

      await transaction.imageSession.update({
        where: {
          id: sessionId,
        },
        data: {
          updatedAt: new Date(),
        },
      });
    });
  } catch (error) {
    console.error("Failed to delete versions:", error);

    return response.status(500).json({
      success: false,
      message: "Failed to delete the selected versions.",
    });
  }

  const storageResults = await Promise.allSettled(
    assets.map((asset) => unlink(join(getStorageRoot(), asset.filePath))),
  );

  storageResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(
        `[Versions] Database asset ${assets[index]?.id} was deleted, but its image file could not be removed:`,
        result.reason,
      );
    }
  });

  return response.json({
    success: true,
    data: {
      deletedCount: validAssetIds.length,
      deletedAssetIds: validAssetIds,
    },
  });
}
