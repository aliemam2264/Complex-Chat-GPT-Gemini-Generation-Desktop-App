"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiDelete, apiGet, apiPatch } from "@/lib/api";
import type { PreserveMode } from "@/types/generation";

export type PromptPreset = {
  mode: PreserveMode;
  label: string;
  description: string;
  defaultPrompt: string;
  overridePrompt: string | null;
  effectivePrompt: string;
  isCustomized: boolean;
};

export type PromptPresetSettings = {
  presets: PromptPreset[];
};

export function usePromptPresets() {
  return useQuery({
    queryKey: ["prompt-presets"],
    queryFn: () => apiGet<PromptPresetSettings>("/api/generations/prompt-presets"),
    refetchOnWindowFocus: true,
  });
}

export function useSavePromptPreset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ mode, prompt }: { mode: PreserveMode; prompt: string }) =>
      apiPatch<PromptPresetSettings, { prompt: string }>(
        `/api/generations/prompt-presets/${mode}`,
        { prompt },
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(["prompt-presets"], data);
    },
  });
}

export function useResetPromptPreset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mode: PreserveMode) =>
      apiDelete<PromptPresetSettings>(`/api/generations/prompt-presets/${mode}`),
    onSuccess: (data) => {
      queryClient.setQueryData(["prompt-presets"], data);
    },
  });
}
