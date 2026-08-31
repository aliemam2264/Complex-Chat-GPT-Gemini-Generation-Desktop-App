"use client";

import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api";

import type { GenerationRun } from "@/types/generation";

const ACTIVE_STATUSES = new Set(["PENDING", "PROMPTING", "PROMPT_READY", "GENERATING", "DOWNLOADING"]);

export function useGenerationStatus(generationId?: string | null) {
  return useQuery({
    queryKey: ["generation", generationId],

    queryFn: () => apiGet<GenerationRun>(`/api/generations/${generationId}`),

    enabled: Boolean(generationId),

    refetchInterval: (query) => {
      const status = query.state.data?.status;

      if (status && ACTIVE_STATUSES.has(status)) {
        return 1000;
      }

      return false;
    },

    refetchOnWindowFocus: false,

    retry: false,
  });
}
