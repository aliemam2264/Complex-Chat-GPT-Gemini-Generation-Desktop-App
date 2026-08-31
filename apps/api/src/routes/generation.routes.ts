import { Router } from "express";

import { getGenerationSettings, updateGenerationSettings } from "../controllers/generation-settings.controller";
import {
  getPromptPresets,
  resetPromptPreset,
  updatePromptPreset,
} from "../controllers/prompt-preset-settings.controller";

import {
  connectChatGPT,
  connectGemini,
  getChatGPTStatus,
  getGeminiStatus,
  regeneratePrompt,
  sendToNanoBanana,
  updatePrompt,
  getGeneration,
  getGenerationActivity,
  cancelGeneration,
  retryGeneration,
} from "../controllers/generation.controller";

export const generationRouter = Router();

generationRouter.get("/settings", getGenerationSettings);

generationRouter.patch("/settings", updateGenerationSettings);

generationRouter.get("/prompt-presets", getPromptPresets);

generationRouter.patch("/prompt-presets/:mode", updatePromptPreset);

generationRouter.delete("/prompt-presets/:mode", resetPromptPreset);

generationRouter.post("/:generationId/cancel", cancelGeneration);

generationRouter.post("/:generationId/retry", retryGeneration);

generationRouter.post("/:generationId/regenerate-prompt", regeneratePrompt);

generationRouter.patch("/:generationId/prompt", updatePrompt);

generationRouter.post("/:generationId/nano-banana", sendToNanoBanana);

generationRouter.post("/providers/gemini/connect", connectGemini);

generationRouter.get("/providers/gemini/status", getGeminiStatus);

generationRouter.get("/providers/chatgpt/status", getChatGPTStatus);

generationRouter.post("/providers/chatgpt/connect", connectChatGPT);

generationRouter.get("/activity", getGenerationActivity);

generationRouter.get("/:generationId", getGeneration);
