import type { Request, Response } from "express";

import { prisma } from "@eskander/database";

type SessionParams = {
  projectId: string;
  sessionId: string;
};

export async function getRenderFlow(request: Request<SessionParams>, response: Response) {
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
      generations: {
        orderBy: {
          createdAt: "asc",
        },
        include: {
          sourceAsset: true,
          outputAsset: true,
          referenceImages: {
            orderBy: {
              sortOrder: "asc",
            },
          },
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
    data: {
      session: {
        id: session.id,
        projectId: session.projectId,
        name: session.name,
        assets: session.assets,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      generations: session.generations,
    },
  });
}
