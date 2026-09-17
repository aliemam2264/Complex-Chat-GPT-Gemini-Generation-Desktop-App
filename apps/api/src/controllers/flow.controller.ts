import type { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "@eskander/database";

const flowStateSchema = z.object({ state: z.unknown() });

type SessionParams = {
  projectId: string;
  sessionId: string;
};

function parseFlowState(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

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
        flowState: parseFlowState(session.flowStateJson),
      },
      generations: session.generations,
    },
  });
}


export async function updateRenderFlowState(request: Request<SessionParams>, response: Response) {
  const { projectId, sessionId } = request.params;
  const parsed = flowStateSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(422).json({ success: false, message: "Invalid canvas state." });
  }

  const serialized = JSON.stringify(parsed.data.state ?? null);
  if (Buffer.byteLength(serialized, "utf8") > 1_500_000) {
    return response.status(413).json({ success: false, message: "Canvas state is too large." });
  }

  const session = await prisma.imageSession.findFirst({
    where: { id: sessionId, projectId },
    select: { id: true },
  });

  if (!session) {
    return response.status(404).json({ success: false, message: "Canvas not found." });
  }

  await prisma.imageSession.update({
    where: { id: sessionId },
    data: { flowStateJson: serialized },
  });

  return response.json({ success: true, data: null });
}
