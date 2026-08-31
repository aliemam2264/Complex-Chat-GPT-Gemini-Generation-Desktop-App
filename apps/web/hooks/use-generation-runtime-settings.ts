"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPatch } from "@/lib/api";

export type GenerationRuntimeSettings = {
  promptMaxConcurrency: number | null;
  imageMaxConcurrency: number | null;
  runtime: {
    chatgpt: {
      active: number;
      waiting: number;
      maxConcurrency: number | null;
    };
    gemini: {
      active: number;
      waiting: number;
      maxConcurrency: number | null;
    };
  };
};

export type GenerationRuntimeSettingsInput = Pick<
  GenerationRuntimeSettings,
  "promptMaxConcurrency" | "imageMaxConcurrency"
>;

export function useGenerationRuntimeSettings() {
  return useQuery({
    queryKey: ["generation-runtime-settings"],
    queryFn: () =>
      apiGet<GenerationRuntimeSettings>("/api/generations/settings"),
    refetchInterval: 2_000,
    refetchOnWindowFocus: true,
  });
}

export function useUpdateGenerationRuntimeSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: GenerationRuntimeSettingsInput) =>
      apiPatch<GenerationRuntimeSettings, GenerationRuntimeSettingsInput>(
        "/api/generations/settings",
        input,
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(["generation-runtime-settings"], data);
    },
  });
}
