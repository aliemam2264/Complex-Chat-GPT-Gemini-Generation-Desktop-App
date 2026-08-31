"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiDelete, apiGet, apiPost } from "@/lib/api";

import type { Project } from "@/types/project";

type CreateProjectInput = {
  name: string;
  description?: string;
};

type DeleteProjectsResult = {
  deletedCount: number;
  deletedProjectIds: string[];
};

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<Project[]>("/api/projects"),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectInput) => apiPost<Project, CreateProjectInput>("/api/projects", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["projects"],
      });
    },
  });
}

export function useDeleteProjects() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectIds: string[]) =>
      apiDelete<DeleteProjectsResult, { projectIds: string[] }>("/api/projects", {
        projectIds,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["projects"],
      });
    },
  });
}
