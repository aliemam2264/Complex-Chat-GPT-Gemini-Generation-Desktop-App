"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiUpload } from "@/lib/api";

import type { ImageSession } from "@/types/project";

export const RENDER_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

export const RENDER_MAX_FILE_SIZE = 50 * 1024 * 1024;

const SUPPORTED_RENDER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateRenderImage(file: File) {
  if (!SUPPORTED_RENDER_TYPES.has(file.type)) {
    return "Only JPG, PNG and WebP images are supported.";
  }

  if (file.size > RENDER_MAX_FILE_SIZE) {
    return "Image must be smaller than 50 MB.";
  }

  return null;
}

export function useRenderUpload(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();

      formData.append("image", file);

      return apiUpload<ImageSession>(`/api/projects/${projectId}/image-sessions`, formData);
    },

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
