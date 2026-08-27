import { Router } from "express";

import { createProject, getProject, getProjects } from "../src/controllers/project.controller";

import { createImageSession } from "../src/controllers/image-session.controller";

import { uploadRender } from "../src/middleware/upload-render";

export const projectRouter = Router();

projectRouter.get("/", getProjects);

projectRouter.get("/:projectId", getProject);

projectRouter.post("/", createProject);

projectRouter.post("/:projectId/image-sessions", uploadRender.single("image"), createImageSession);
