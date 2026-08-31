"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiDelete } from "@/lib/api";

type DeleteVersionsResponse = {
  deletedCount: number;
  deletedAssetIds: string[];
};

export function useDeleteVersions(projectId: string, sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (assetIds: string[]) =>
      apiDelete<
        DeleteVersionsResponse,
        {
          assetIds: string[];
        }
      >(`/api/projects/${projectId}/image-sessions/${sessionId}/assets`, {
        assetIds,
      }),

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["image-session", sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["project", projectId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["generation-activity"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["generation"],
        }),
      ]);
    },
  });
}
