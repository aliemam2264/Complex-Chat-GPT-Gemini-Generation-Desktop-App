"use client";

import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api";
import type { GenerationRun } from "@/types/generation";
import type { Asset } from "@/types/project";

export type GenerationHistoryItem = GenerationRun & {
  sourceAsset: Asset;
  outputAsset: Asset | null;
};

const ACTIVE_STATUSES = new Set([
  "PENDING",
  "PROMPTING",
  "PROMPT_READY",
  "GENERATING",
  "DOWNLOADING",
]);

export function useGenerationHistory(projectId: string, sessionId: string) {
  return useQuery({
    queryKey: ["generation-history", projectId, sessionId],
    queryFn: () =>
      apiGet<GenerationHistoryItem[]>(
        `/api/projects/${projectId}/image-sessions/${sessionId}/generations`,
      ),
    enabled: Boolean(projectId && sessionId),
    refetchInterval: (query) => {
      const history = query.state.data;

      if (!history) {
        return 2_000;
      }

      return history.some((item) => ACTIVE_STATUSES.has(item.status))
        ? 1_500
        : false;
    },
    refetchOnWindowFocus: true,
    staleTime: 1_000,
  });
}
