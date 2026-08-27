import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import { getStorageRoot } from "../config/storage";
import { imageJobManager, promptJobManager } from "./background-job-manager";

const concurrencyValueSchema = z.union([
  z.null(),
  z.number().int().min(1).max(12),
]);

export const generationRuntimeSettingsSchema = z.object({
  promptMaxConcurrency: concurrencyValueSchema,
  imageMaxConcurrency: concurrencyValueSchema,
});

export type GenerationRuntimeSettings = z.infer<
  typeof generationRuntimeSettingsSchema
>;

const DEFAULT_SETTINGS: GenerationRuntimeSettings = {
  // null means unlimited. This intentionally preserves the app's current
  // fully-parallel generation behavior until the user chooses a limit.
  promptMaxConcurrency: null,
  imageMaxConcurrency: null,
};

function getSettingsPath() {
  return join(getStorageRoot(), "settings", "generation-runtime.json");
}

let cachedSettings: GenerationRuntimeSettings | null = null;
let writeChain = Promise.resolve();

function applySettings(settings: GenerationRuntimeSettings) {
  promptJobManager.setMaxConcurrency(settings.promptMaxConcurrency);
  imageJobManager.setMaxConcurrency(settings.imageMaxConcurrency);
}

export async function getGenerationRuntimeSettings() {
  if (cachedSettings) {
    return cachedSettings;
  }

  try {
    const raw = await readFile(getSettingsPath(), "utf8");
    const parsed = generationRuntimeSettingsSchema.safeParse(JSON.parse(raw));

    cachedSettings = parsed.success ? parsed.data : DEFAULT_SETTINGS;
  } catch {
    cachedSettings = DEFAULT_SETTINGS;
  }

  applySettings(cachedSettings);
  return cachedSettings;
}

export async function saveGenerationRuntimeSettings(
  settings: GenerationRuntimeSettings,
) {
  const parsed = generationRuntimeSettingsSchema.parse(settings);
  const path = getSettingsPath();

  cachedSettings = parsed;
  applySettings(parsed);

  writeChain = writeChain.then(async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  });

  await writeChain;
  return parsed;
}

export async function initializeGenerationRuntimeSettings() {
  return getGenerationRuntimeSettings();
}

export function getGenerationRuntimeSnapshot() {
  return {
    chatgpt: {
      active: promptJobManager.getActiveCount(),
      waiting: promptJobManager.getQueuedCount(),
      maxConcurrency: promptJobManager.getMaxConcurrency(),
    },
    gemini: {
      active: imageJobManager.getActiveCount(),
      waiting: imageJobManager.getQueuedCount(),
      maxConcurrency: imageJobManager.getMaxConcurrency(),
    },
  };
}
