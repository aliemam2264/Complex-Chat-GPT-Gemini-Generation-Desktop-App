import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import { getStorageRoot } from "../config/storage";

export const PROMPT_PRESET_MODES = [
  "STRICT",
  "BALANCED",
  "CREATIVE",
  "NO_RESTRICTION",
] as const;

export type PromptPresetMode = (typeof PROMPT_PRESET_MODES)[number];

export const DEFAULT_PROMPT_PRESETS: Record<PromptPresetMode, string> = {
  STRICT:
    "Apply only the exact requested change. Preserve everything else as precisely as possible.",
  BALANCED:
    "Apply the requested change clearly while preserving the original image structure, composition, and identity.",
  CREATIVE:
    "Apply the requested change creatively, but still keep the source image recognizable and consistent with the user's intent.",
  NO_RESTRICTION:
    "Do not add preservation constraints beyond the user's explicit request. Allow broad edits, restyling, replacement, recomposition, and structural changes when they help fulfill the instruction.",
};

const presetPromptSchema = z.string().trim().min(1).max(6000);

const storedSettingsSchema = z.object({
  version: z.literal(1).optional(),
  overrides: z
    .object({
      STRICT: presetPromptSchema.optional(),
      BALANCED: presetPromptSchema.optional(),
      CREATIVE: presetPromptSchema.optional(),
      NO_RESTRICTION: presetPromptSchema.optional(),
    })
    .default({}),
});

type StoredPromptPresetSettings = z.infer<typeof storedSettingsSchema>;

type PromptPresetOverrideMap = StoredPromptPresetSettings["overrides"];

const PRESET_METADATA: Record<
  PromptPresetMode,
  { label: string; description: string }
> = {
  STRICT: {
    label: "Strict",
    description: "Maximum preservation. Only the requested change should move.",
  },
  BALANCED: {
    label: "Balanced",
    description: "Preserve the source while allowing natural supporting adjustments.",
  },
  CREATIVE: {
    label: "Creative",
    description: "More visual freedom while keeping the source recognizable.",
  },
  NO_RESTRICTION: {
    label: "No Restriction",
    description: "Do not add preservation constraints beyond the user's instruction.",
  },
};

function getSettingsPath() {
  return join(getStorageRoot(), "settings", "prompt-presets.json");
}

let cachedOverrides: PromptPresetOverrideMap | null = null;
let writeChain = Promise.resolve();

async function loadOverrides(): Promise<PromptPresetOverrideMap> {
  if (cachedOverrides) {
    return cachedOverrides;
  }

  try {
    const raw = await readFile(getSettingsPath(), "utf8");
    const parsed = storedSettingsSchema.safeParse(JSON.parse(raw));

    cachedOverrides = parsed.success ? parsed.data.overrides : {};
  } catch {
    cachedOverrides = {};
  }

  return cachedOverrides;
}

async function persistOverrides(overrides: PromptPresetOverrideMap) {
  const path = getSettingsPath();

  writeChain = writeChain.then(async () => {
    await mkdir(dirname(path), { recursive: true });

    await writeFile(
      path,
      JSON.stringify(
        {
          version: 1,
          overrides,
        },
        null,
        2,
      ),
      "utf8",
    );
  });

  await writeChain;
}

export async function getEffectivePromptPreset(mode: PromptPresetMode) {
  const overrides = await loadOverrides();

  return overrides[mode] ?? DEFAULT_PROMPT_PRESETS[mode];
}

export async function getPromptPresetSettings() {
  const overrides = await loadOverrides();

  return {
    presets: PROMPT_PRESET_MODES.map((mode) => {
      const overridePrompt = overrides[mode] ?? null;
      const defaultPrompt = DEFAULT_PROMPT_PRESETS[mode];

      return {
        mode,
        label: PRESET_METADATA[mode].label,
        description: PRESET_METADATA[mode].description,
        defaultPrompt,
        overridePrompt,
        effectivePrompt: overridePrompt ?? defaultPrompt,
        isCustomized: overridePrompt !== null,
      };
    }),
  };
}

export async function savePromptPresetOverride(
  mode: PromptPresetMode,
  prompt: string,
) {
  const parsedPrompt = presetPromptSchema.parse(prompt);
  const current = await loadOverrides();
  const next = { ...current };

  /*
   * Saving the exact hardcoded default should behave exactly like Reset:
   * do not keep a redundant user override on disk.
   */
  if (parsedPrompt === DEFAULT_PROMPT_PRESETS[mode]) {
    delete next[mode];
  } else {
    next[mode] = parsedPrompt;
  }

  cachedOverrides = next;
  await persistOverrides(next);

  return getPromptPresetSettings();
}

export async function resetPromptPresetOverride(mode: PromptPresetMode) {
  const current = await loadOverrides();
  const next = { ...current };

  delete next[mode];

  cachedOverrides = next;
  await persistOverrides(next);

  return getPromptPresetSettings();
}
