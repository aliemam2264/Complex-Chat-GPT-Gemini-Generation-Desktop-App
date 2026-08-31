"use client";

import { useEffect, useState } from "react";

import type { PreserveMode } from "@/types/generation";

const STORAGE_KEY = "eskander-plus:generation-defaults";

type GenerationDefaults = {
  preserveMode: PreserveMode;
  preserveEverythingElse: boolean;
};

const DEFAULT_SETTINGS: GenerationDefaults = {
  preserveMode: "STRICT",
  preserveEverythingElse: true,
};

export function useGenerationDefaults() {
  const [preserveMode, setPreserveModeState] = useState<PreserveMode>(DEFAULT_SETTINGS.preserveMode);

  const [preserveEverythingElse, setPreserveEverythingElseState] = useState(DEFAULT_SETTINGS.preserveEverythingElse);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as Partial<GenerationDefaults>;

      if (
        parsed.preserveMode === "STRICT" ||
        parsed.preserveMode === "BALANCED" ||
        parsed.preserveMode === "CREATIVE" ||
        parsed.preserveMode === "NO_RESTRICTION"
      ) {
        setPreserveModeState(parsed.preserveMode);
      }

      if (typeof parsed.preserveEverythingElse === "boolean") {
        setPreserveEverythingElseState(parsed.preserveEverythingElse);
      }
    } catch (error) {
      console.error("Could not load generation defaults:", error);
    }
  }, []);

  function saveSettings(settings: GenerationDefaults) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function setPreserveMode(mode: PreserveMode) {
    setPreserveModeState(mode);

    saveSettings({
      preserveMode: mode,
      preserveEverythingElse,
    });
  }

  function setPreserveEverythingElse(value: boolean) {
    setPreserveEverythingElseState(value);

    saveSettings({
      preserveMode,
      preserveEverythingElse: value,
    });
  }

  return {
    preserveMode,
    preserveEverythingElse,
    setPreserveMode,
    setPreserveEverythingElse,
  };
}
