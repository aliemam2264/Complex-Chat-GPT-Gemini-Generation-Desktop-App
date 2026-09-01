"use client";

import { useMutation } from "@tanstack/react-query";

import { apiPatch, apiPost, apiUpload } from "@/lib/api";

import type { GenerationRun, PreserveMode } from "@/types/generation";

type CreatePromptInput = {
  projectId: string;
  sessionId: string;

  sourceAssetId: string;
  instruction: string;

  preserveMode: PreserveMode;

  preserveEverythingElse: boolean;
  referenceImages?: File[];
};

type CreatePromptBody = {
  sourceAssetId: string;
  instruction: string;
  preserveMode: PreserveMode;
  preserveEverythingElse: boolean;
};

export function useCreatePrompt() {
  return useMutation({
    mutationFn: async ({
      projectId,
      sessionId,
      sourceAssetId,
      instruction,
      preserveMode,
      preserveEverythingElse,
      referenceImages = [],
    }: CreatePromptInput) => {
      const formData = new FormData();

      formData.append("sourceAssetId", sourceAssetId);
      formData.append("instruction", instruction);
      formData.append("preserveMode", preserveMode);
      formData.append("preserveEverythingElse", String(preserveEverythingElse));

      for (const image of referenceImages) {
        formData.append("referenceImages", image);
      }

      return apiUpload<GenerationRun>(`/api/projects/${projectId}/image-sessions/${sessionId}/prompts`, formData);
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



type FlowReferenceIds = {
  referenceAssetIds?: string[];
  referenceImageIds?: string[];
};

type RefineFlowPromptInput = FlowReferenceIds & {
  projectId: string;
  sessionId: string;
  sourceAssetId: string;
  instruction: string;
  preserveMode: PreserveMode;
  preserveEverythingElse: boolean;
  includeReferencesInAssistant?: boolean;
};

type CreateFlowImageGenerationInput = FlowReferenceIds & {
  projectId: string;
  sessionId: string;
  sourceAssetId: string;
  instruction: string;
  refinedPrompt: string;
  preserveMode: PreserveMode;
  preserveEverythingElse: boolean;
};

function appendFlowReferenceIds(
  formData: FormData,
  referenceAssetIds: string[] = [],
  referenceImageIds: string[] = [],
) {
  formData.append("referenceAssetIds", JSON.stringify(referenceAssetIds.slice(0, 5)));
  formData.append("referenceImageIds", JSON.stringify(referenceImageIds.slice(0, 5)));
}

export function useRefineFlowPrompt() {
  return useMutation({
    mutationFn: async ({
      projectId,
      sessionId,
      sourceAssetId,
      instruction,
      preserveMode,
      preserveEverythingElse,
      includeReferencesInAssistant = false,
      referenceAssetIds = [],
      referenceImageIds = [],
    }: RefineFlowPromptInput) => {
      const formData = new FormData();

      formData.append("sourceAssetId", sourceAssetId);
      formData.append("instruction", instruction);
      formData.append("preserveMode", preserveMode);
      formData.append("preserveEverythingElse", String(preserveEverythingElse));
      formData.append("includeReferencesInAssistant", String(includeReferencesInAssistant));
      appendFlowReferenceIds(formData, referenceAssetIds, referenceImageIds);

      return apiUpload<{ prompt: string }>(
        `/api/projects/${projectId}/image-sessions/${sessionId}/flow/refine-prompt`,
        formData,
      );
    },
  });
}

export function useCreateFlowImageGeneration() {
  return useMutation({
    mutationFn: async ({
      projectId,
      sessionId,
      sourceAssetId,
      instruction,
      refinedPrompt,
      preserveMode,
      preserveEverythingElse,
      referenceAssetIds = [],
      referenceImageIds = [],
    }: CreateFlowImageGenerationInput) => {
      const formData = new FormData();

      formData.append("sourceAssetId", sourceAssetId);
      formData.append("instruction", instruction);
      formData.append("refinedPrompt", refinedPrompt);
      formData.append("preserveMode", preserveMode);
      formData.append("preserveEverythingElse", String(preserveEverythingElse));
      appendFlowReferenceIds(formData, referenceAssetIds, referenceImageIds);

      return apiUpload<GenerationRun>(
        `/api/projects/${projectId}/image-sessions/${sessionId}/flow/generations`,
        formData,
      );
    },
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
