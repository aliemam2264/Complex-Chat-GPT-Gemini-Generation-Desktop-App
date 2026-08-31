"use client";

import { useMutation } from "@tanstack/react-query";

import { apiPatch, apiPost } from "@/lib/api";

import type { GenerationRun, PreserveMode } from "@/types/generation";

type CreatePromptInput = {
  projectId: string;
  sessionId: string;

  sourceAssetId: string;
  instruction: string;

  preserveMode: PreserveMode;

  preserveEverythingElse: boolean;
};

type CreatePromptBody = {
  sourceAssetId: string;
  instruction: string;
  preserveMode: PreserveMode;
  preserveEverythingElse: boolean;
};

export function useCreatePrompt() {
  return useMutation({
    mutationFn: ({
      projectId,
      sessionId,
      sourceAssetId,
      instruction,
      preserveMode,
      preserveEverythingElse,
    }: CreatePromptInput) => {
      const body: CreatePromptBody = {
        sourceAssetId,
        instruction,
        preserveMode,
        preserveEverythingElse,
      };

      console.log("Create prompt payload:", body);

      return apiPost<GenerationRun, CreatePromptBody>(
        `/api/projects/${projectId}/image-sessions/${sessionId}/prompts`,
        body,
      );
    },
  });
}

export function useRegeneratePrompt() {
  return useMutation({
    mutationFn: (generationId: string) =>
      apiPost<GenerationRun, Record<string, never>>(`/api/generations/${generationId}/regenerate-prompt`, {}),
  });
}

export function useUpdatePrompt() {
  return useMutation({
    mutationFn: ({ generationId, prompt }: { generationId: string; prompt: string }) =>
      apiPatch<
        GenerationRun,
        {
          prompt: string;
        }
      >(`/api/generations/${generationId}/prompt`, {
        prompt,
      }),
  });
}

export function useSendToNanoBanana() {
  return useMutation({
    mutationFn: (generationId: string) =>
      apiPost<GenerationRun, Record<string, never>>(`/api/generations/${generationId}/nano-banana`, {}),
  });
}

export function useConnectGemini() {
  return useMutation({
    mutationFn: () =>
      apiPost<
        {
          message: string;
        },
        Record<string, never>
      >("/api/generations/providers/gemini/connect", {}),
  });
}


export function useCancelGeneration() {
  return useMutation({
    mutationFn: (generationId: string) =>
      apiPost<GenerationRun, Record<string, never>>(`/api/generations/${generationId}/cancel`, {}),
  });
}

export function useRetryGeneration() {
  return useMutation({
    mutationFn: (generationId: string) =>
      apiPost<GenerationRun, Record<string, never>>(`/api/generations/${generationId}/retry`, {}),
  });
}
