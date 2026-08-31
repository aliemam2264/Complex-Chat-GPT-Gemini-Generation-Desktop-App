import type { Request, Response } from "express";
import { z } from "zod";

import {
  PROMPT_PRESET_MODES,
  getPromptPresetSettings,
  resetPromptPresetOverride,
  savePromptPresetOverride,
} from "../services/prompt-preset-settings";

const modeSchema = z.enum(PROMPT_PRESET_MODES);

const updatePresetSchema = z.object({
  prompt: z.string().trim().min(1).max(6000),
});

function parseMode(request: Request, response: Response) {
  const parsed = modeSchema.safeParse(request.params.mode);

  if (!parsed.success) {
    response.status(404).json({
      success: false,
      message: "Prompt preset not found.",
    });

    return null;
  }

  return parsed.data;
}

export async function getPromptPresets(_request: Request, response: Response) {
  const settings = await getPromptPresetSettings();

  return response.json({
    success: true,
    data: settings,
  });
}

export async function updatePromptPreset(request: Request, response: Response) {
  const mode = parseMode(request, response);

  if (!mode) {
    return;
  }

  const parsed = updatePresetSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(422).json({
      success: false,
      message: "Prompt preset must contain between 1 and 6000 characters.",
    });
  }

  const settings = await savePromptPresetOverride(mode, parsed.data.prompt);

  return response.json({
    success: true,
    data: settings,
  });
}

export async function resetPromptPreset(request: Request, response: Response) {
  const mode = parseMode(request, response);

  if (!mode) {
    return;
  }

  const settings = await resetPromptPresetOverride(mode);

  return response.json({
    success: true,
    data: settings,
  });
}
