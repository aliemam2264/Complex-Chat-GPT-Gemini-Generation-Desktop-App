import { Router } from "express";

import { createProject, deleteProjects, getProject, getProjects } from "../controllers/project.controller";

import { uploadRender } from "../middleware/upload-render";

import {
  createImageSession,
  deleteImageSessions,
  deleteVersions,
  getImageSession,
} from "../controllers/image-session.controller";

import { createPrompt, getGenerationHistory } from "../controllers/generation.controller";

export const projectRouter = Router();

projectRouter.get("/", getProjects);
projectRouter.post("/", createProject);
projectRouter.delete("/", deleteProjects);

projectRouter.get("/:projectId/image-sessions/:sessionId/generations", getGenerationHistory);
projectRouter.get("/:projectId/image-sessions/:sessionId", getImageSession);
projectRouter.post("/:projectId/image-sessions", uploadRender.single("image"), createImageSession);
projectRouter.delete("/:projectId/image-sessions", deleteImageSessions);
projectRouter.delete("/:projectId/image-sessions/:sessionId/assets", deleteVersions);
projectRouter.post(
  "/:projectId/image-sessions/:sessionId/prompts",
  uploadRender.array("referenceImages", 5),
  createPrompt,
);

projectRouter.get("/:projectId", getProject);
