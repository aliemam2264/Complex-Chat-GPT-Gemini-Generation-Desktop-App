"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { apiGet, apiPost } from "@/lib/api";

export type ProviderConnectionStatus = {
  connected: boolean;
  message: string;
};

export function useGeminiStatus() {
  return useQuery({
    queryKey: ["provider", "gemini", "status"],

    queryFn: () => apiGet<ProviderConnectionStatus>("/api/generations/providers/gemini/status"),

    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useConnectGeminiSettings() {
  return useMutation({
    mutationFn: () =>
      apiPost<{ message: string }, Record<string, never>>("/api/generations/providers/gemini/connect", {}),
  });
}

export function useChatGPTStatus() {
  return useQuery({
    queryKey: ["provider", "chatgpt", "status"],

    queryFn: () => apiGet<ProviderConnectionStatus>("/api/generations/providers/chatgpt/status"),

    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useConnectChatGPTSettings() {
  return useMutation({
    mutationFn: () =>
      apiPost<
        {
          message: string;
        },
        Record<string, never>
      >("/api/generations/providers/chatgpt/connect", {}),
  });
}
