import { rm } from "node:fs/promises";
import { join } from "node:path";

import type { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "@eskander/database";

import { getStorageRoot } from "../config/storage";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
});

const deleteProjectsSchema = z.object({
  projectIds: z.array(z.string().min(1)).min(1),
});

const ACTIVE_GENERATION_STATUSES = ["PENDING", "PROMPTING", "GENERATING", "DOWNLOADING"] as const;

export async function getProjects(_request: Request, response: Response) {
  const projects = await prisma.project.findMany({
    orderBy: {
      updatedAt: "desc",
    },
    include: {
      _count: {
        select: {
          imageSessions: true,
        },
      },
    },
  });

  return response.json({
    success: true,
    data: projects,
  });
}

export async function getProject(request: Request, response: Response) {
  const { projectId } = request.params;

  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
    include: {
      imageSessions: {
        orderBy: {
          createdAt: "desc",
        },
        include: {
          assets: {
            orderBy: {
              createdAt: "asc",
            },
          },
        },
      },
    },
  });

  if (!project) {
    return response.status(404).json({
      success: false,
      message: "Project not found.",
    });
  }

  return response.json({
    success: true,
    data: project,
  });
}

export async function createProject(request: Request, response: Response) {
  const parsed = createProjectSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(422).json({
      success: false,
      message: "Invalid project data.",
      errors: parsed.error.flatten(),
    });
  }

  const project = await prisma.project.create({
    data: parsed.data,
  });

  return response.status(201).json({
    success: true,
    data: project,
  });
}

export async function deleteProjects(request: Request, response: Response) {
  const parsed = deleteProjectsSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(422).json({
      success: false,
      message: "Select at least one project to delete.",
      errors: parsed.error.flatten(),
    });
  }

  const requestedProjectIds = Array.from(new Set(parsed.data.projectIds));

  const projects = await prisma.project.findMany({
    where: {
      id: {
        in: requestedProjectIds,
      },
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (projects.length === 0) {
    return response.status(404).json({
      success: false,
      message: "No matching projects were found.",
    });
  }

  const validProjectIds = projects.map((project) => project.id);

  /*
   * Don't delete a project while a browser automation job is still using it.
   * Otherwise Gemini/ChatGPT may finish afterwards and recreate files or try to
   * update rows that were already deleted.
   */
  const activeGeneration = await prisma.generationRun.findFirst({
    where: {
      projectId: {
        in: validProjectIds,
      },
      status: {
        in: [...ACTIVE_GENERATION_STATUSES],
      },
    },
    select: {
      id: true,
      projectId: true,
    },
  });

  if (activeGeneration) {
    return response.status(409).json({
      success: false,
      message:
        "One of the selected projects still has an active generation. Wait for it to finish, then delete the project.",
    });
  }

  /*
   * Prisma relations are configured with cascade deletes, so deleting the
   * Project removes its ImageSessions, Assets and GenerationRuns as well.
   */
  const deleted = await prisma.project.deleteMany({
    where: {
      id: {
        in: validProjectIds,
      },
    },
  });

  /*
   * Remove each project's complete storage directory:
   * storage/projects/{projectId}/...
   */
  const storageResults = await Promise.allSettled(
    validProjectIds.map((projectId) =>
      rm(join(getStorageRoot(), "projects", projectId), {
        recursive: true,
        force: true,
      }),
    ),
  );

  storageResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(
        `[Projects] Database rows for ${validProjectIds[index]} were deleted, but its storage directory could not be removed:`,
        result.reason,
      );
    }
  });

  return response.json({
    success: true,
    data: {
      deletedCount: deleted.count,
      deletedProjectIds: validProjectIds,
    },
  });
}
