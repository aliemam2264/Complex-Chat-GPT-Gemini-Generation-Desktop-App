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
import { getRenderFlow } from "../controllers/flow.controller";
import { createFlowImageGeneration, refineFlowPrompt, uploadFlowImage } from "../controllers/flow-generation.controller";

export const projectRouter = Router();

projectRouter.get("/", getProjects);
projectRouter.post("/", createProject);
projectRouter.delete("/", deleteProjects);

projectRouter.get("/:projectId/image-sessions/:sessionId/flow", getRenderFlow);
projectRouter.post(
  "/:projectId/image-sessions/:sessionId/flow/images",
  uploadRender.single("image"),
  uploadFlowImage,
);
projectRouter.post(
  "/:projectId/image-sessions/:sessionId/flow/refine-prompt",
  uploadRender.array("referenceImages", 5),
  refineFlowPrompt,
);
projectRouter.post(
  "/:projectId/image-sessions/:sessionId/flow/generations",
  uploadRender.array("referenceImages", 5),
  createFlowImageGeneration,
);
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
