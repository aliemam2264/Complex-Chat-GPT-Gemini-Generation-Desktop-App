import type { Request, Response } from "express";

import {
  generationRuntimeSettingsSchema,
  getGenerationRuntimeSettings,
  getGenerationRuntimeSnapshot,
  saveGenerationRuntimeSettings,
} from "../services/generation-runtime-settings";

export async function getGenerationSettings(_request: Request, response: Response) {
  const settings = await getGenerationRuntimeSettings();

  return response.json({
    success: true,
    data: {
      ...settings,
      runtime: getGenerationRuntimeSnapshot(),
    },
  });
}

export async function updateGenerationSettings(request: Request, response: Response) {
  const parsed = generationRuntimeSettingsSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(422).json({
      success: false,
      message: "Concurrency must be Unlimited or a whole number between 1 and 12.",
    });
  }

  const settings = await saveGenerationRuntimeSettings(parsed.data);

  return response.json({
    success: true,
    data: {
      ...settings,
      runtime: getGenerationRuntimeSnapshot(),
    },
  });
}
