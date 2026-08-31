"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiDelete } from "@/lib/api";

type DeleteResponse = {
  deletedCount: number;
  deletedSessionIds: string[];
};

export function useDeleteImageSessions(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionIds: string[]) =>
      apiDelete<
        DeleteResponse,
        {
          sessionIds: string[];
        }
      >(`/api/projects/${projectId}/image-sessions`, {
        sessionIds,
      }),

    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["project", projectId],
        }),

        queryClient.invalidateQueries({
          queryKey: ["projects"],
        }),
      ]);
    },
  });
}
