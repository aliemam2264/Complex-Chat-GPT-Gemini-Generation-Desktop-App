"use client";

import {
  Ban,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { GeminiProgress } from "@/components/generation/gemini-progress";
import { PromptProgress } from "@/components/generation/prompt-progress";
import { useGenerationStatus } from "@/hooks/use-generation-status";
import {
  useCancelGeneration,
  useRetryGeneration,
} from "@/hooks/use-prompt-generation";
import { useGenerationActivityStore } from "@/stores/use-generation-activity-store";
import type { GenerationRun } from "@/types/generation";

const ACTIVE_STATUSES = new Set([
  "PENDING",
  "PROMPTING",
  "PROMPT_READY",
  "GENERATING",
  "DOWNLOADING",
]);

export function GenerationInspectorModal() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const generationId = useGenerationActivityStore(
    (state) => state.selectedGenerationId,
  );

  const closeGeneration = useGenerationActivityStore(
    (state) => state.closeGeneration,
  );

  const generationQuery = useGenerationStatus(generationId);
  const cancelGeneration = useCancelGeneration();
  const retryGeneration = useRetryGeneration();

  if (!generationId) {
    return null;
  }

  const generation = generationQuery.data;
  const loading = generationQuery.isLoading && !generation;
  const queryFailed = generationQuery.isError && !generation;

  const promptRunning =
    generation?.status === "PENDING" || generation?.status === "PROMPTING";

  const promptHandoff = generation?.status === "PROMPT_READY";

  const geminiRunning =
    generation?.status === "GENERATING" || generation?.status === "DOWNLOADING";

  const completed = generation?.status === "COMPLETED";
  const failed = generation?.status === "FAILED";
  const canceled = generation?.status === "CANCELED";
  const interrupted = failed && generation?.progressStage === "INTERRUPTED";

  const geminiFailed =
    failed &&
    Boolean(
      generation?.imageProvider === "GEMINI_BROWSER" ||
        generation?.progressStage?.startsWith("GEMINI_") ||
        generation?.progressStage === "SAVING_VERSION",
    );

  const isActive = Boolean(generation && ACTIVE_STATUSES.has(generation.status));

  function syncGeneration(updated: GenerationRun) {
    queryClient.setQueryData(["generation", updated.id], updated);

    void queryClient.invalidateQueries({
      queryKey: ["generation-activity"],
    });
  }

  async function handleCancel() {
    if (!generation || !isActive) {
      return;
    }

    try {
      const updated = await cancelGeneration.mutateAsync(generation.id);
      syncGeneration(updated);
    } catch (error) {
      console.error("Could not cancel generation:", error);
    }
  }

  async function handleRetry() {
    if (!generation || (!failed && !canceled)) {
      return;
    }

    try {
      const updated = await retryGeneration.mutateAsync(generation.id);
      syncGeneration(updated);
    } catch (error) {
      console.error("Could not retry generation:", error);
    }
  }

  function getHeaderState() {
    if (completed) {
      return {
        title: "Generation Complete",
        subtitle: "Your generated render is ready.",
        label: "Done",
        labelClassName:
          "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
      };
    }

    if (canceled) {
      return {
        title: "Generation Canceled",
        subtitle: "This generation was stopped before completion.",
        label: "Canceled",
        labelClassName: "border-white/10 bg-white/[0.04] text-white/60",
      };
    }

    if (failed) {
      return {
        title: interrupted
          ? "Generation Interrupted"
          : geminiFailed
            ? "Image Generation Failed"
            : "Prompt Generation Failed",
        subtitle: interrupted
          ? "The app restarted while this generation was running."
          : "The background generation needs attention.",
        label: interrupted ? "Interrupted" : "Failed",
        labelClassName: "border-red-500/20 bg-red-500/10 text-red-400",
      };
    }

    if (geminiRunning) {
      return {
        title: "Generating Image",
        subtitle: "Gemini is processing your architectural render.",
        label: generation?.progressStage === "GEMINI_STARTING" ? "Starting" : "Running",
        labelClassName:
          "border-[#b6a080]/20 bg-[#b6a080]/10 text-[#c9b28f]",
      };
    }

    if (promptHandoff) {
      return {
        title: "Preparing Image Generation",
        subtitle: "The prompt is ready. Gemini is starting automatically.",
        label: "Starting",
        labelClassName:
          "border-[#b6a080]/20 bg-[#b6a080]/10 text-[#c9b28f]",
      };
    }

    if (promptRunning) {
      return {
        title: "Building Prompt",
        subtitle: "ChatGPT is analyzing the selected render.",
        label: "Running",
        labelClassName:
          "border-[#b6a080]/20 bg-[#b6a080]/10 text-[#c9b28f]",
      };
    }

    return {
      title: "Generation Details",
      subtitle: "Background generation",
      label: "Loading",
      labelClassName: "border-[var(--border)] text-[var(--foreground-muted)]",
    };
  }

  const headerState = getHeaderState();

  function handleOpenRender() {
    if (!generation) {
      return;
    }

    closeGeneration();
    router.push(
      `/projects/${generation.projectId}/renders/${generation.imageSessionId}`,
    );
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-6 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeGeneration();
        }
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-[900px] flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-medium">{headerState.title}</h2>

              <span
                className={[
                  "rounded-full border px-2.5 py-1 text-xs font-medium",
                  headerState.labelClassName,
                ].join(" ")}
              >
                {headerState.label}
              </span>
            </div>

            <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">
              {headerState.subtitle}
            </p>

            {generation && (
              <p className="mt-1 text-xs text-[var(--foreground-subtle)]">
                Generation #{generation.id.slice(-6)} · Attempt {Math.max(1, generation.attemptCount)}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={closeGeneration}
            aria-label="Close generation details"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        {loading && (
          <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
            <LoaderCircle
              size={24}
              strokeWidth={1.7}
              className="animate-spin text-[#c9b28f]"
            />
            <p className="mt-4 text-sm text-[var(--foreground-muted)]">
              Loading generation details...
            </p>
          </div>
        )}

        {queryFailed && (
          <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 text-red-400">
              <CircleAlert size={21} strokeWidth={1.8} />
            </div>
            <h3 className="mt-4 text-base font-medium">Could not load generation</h3>
            <p className="mt-2 max-w-[460px] text-sm leading-6 text-[var(--foreground-muted)]">
              The generation status could not be loaded.
            </p>
            <button
              type="button"
              onClick={() => generationQuery.refetch()}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-xl border border-[var(--border)] px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
            >
              Try Again
            </button>
          </div>
        )}

        {generation && promptRunning && <PromptProgress generation={generation} />}

        {generation && promptHandoff && (
          <div className="flex min-h-[380px] flex-col items-center justify-center p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 size={21} strokeWidth={1.8} />
            </div>
            <h3 className="mt-5 text-base font-medium">Prompt ready</h3>
            <p className="mt-2 max-w-[460px] text-sm leading-6 text-[var(--foreground-muted)]">
              ChatGPT finished the architectural prompt. Gemini will start automatically.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-4 py-2 text-xs text-[var(--foreground-muted)]">
              <LoaderCircle
                size={13}
                strokeWidth={1.8}
                className="animate-spin text-[#c9b28f]"
              />
              Starting Gemini...
            </div>
          </div>
        )}

        {generation && geminiRunning && <GeminiProgress generation={generation} />}

        {generation && completed && (
          <div className="flex min-h-[380px] flex-col items-center justify-center p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 size={24} strokeWidth={1.8} />
            </div>
            <h3 className="mt-5 text-base font-medium">Generation complete</h3>
            <p className="mt-2 max-w-[460px] text-sm leading-6 text-[var(--foreground-muted)]">
              The generated render has been saved successfully as a new version.
            </p>
            <div className="mt-6 flex items-center gap-2">
              <button
                type="button"
                onClick={closeGeneration}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--border)] px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleOpenRender}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-opacity hover:opacity-90"
              >
                <ExternalLink size={15} strokeWidth={1.8} />
                Open Render
              </button>
            </div>
          </div>
        )}

        {generation && (failed || canceled) && (
          <div className="flex min-h-[380px] flex-col items-center justify-center p-8 text-center">
            <div
              className={[
                "flex h-12 w-12 items-center justify-center rounded-full border",
                canceled
                  ? "border-white/10 bg-white/[0.04] text-white/60"
                  : "border-red-500/20 bg-red-500/10 text-red-400",
              ].join(" ")}
            >
              {canceled ? (
                <Ban size={22} strokeWidth={1.8} />
              ) : (
                <CircleAlert size={22} strokeWidth={1.8} />
              )}
            </div>

            <h3 className="mt-5 text-base font-medium">
              {canceled
                ? "Generation canceled"
                : interrupted
                  ? "Generation interrupted"
                  : geminiFailed
                    ? "Image generation failed"
                    : "Prompt generation failed"}
            </h3>

            <p className="mt-2 max-w-[520px] text-sm leading-6 text-[var(--foreground-muted)]">
              {generation.errorMessage ??
                generation.progressMessage ??
                (canceled
                  ? "This generation was stopped before completion."
                  : "Something went wrong while processing this generation.")}
            </p>

            {generation.progressStage === "CHATGPT_LOGIN_REQUIRED" && (
              <p className="mt-3 text-sm text-[#c9b28f]">
                Reconnect ChatGPT from Settings before retrying.
              </p>
            )}

            {generation.progressStage === "GEMINI_LOGIN_REQUIRED" && (
              <p className="mt-3 text-sm text-[#c9b28f]">
                Reconnect Gemini from Settings before retrying.
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={closeGeneration}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--border)] px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
              >
                Close
              </button>

              <button
                type="button"
                onClick={handleRetry}
                disabled={retryGeneration.isPending}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {retryGeneration.isPending ? (
                  <LoaderCircle size={15} className="animate-spin" />
                ) : (
                  <RotateCcw size={15} strokeWidth={1.8} />
                )}
                {retryGeneration.isPending ? "Retrying..." : "Retry Generation"}
              </button>

              <button
                type="button"
                onClick={handleOpenRender}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
              >
                <ExternalLink size={15} strokeWidth={1.8} />
                Open Render
              </button>
            </div>
          </div>
        )}

        {generation &&
          !promptRunning &&
          !promptHandoff &&
          !geminiRunning &&
          !completed &&
          !failed &&
          !canceled && (
            <div className="flex min-h-[340px] flex-col items-center justify-center p-8 text-center">
              <LoaderCircle
                size={22}
                strokeWidth={1.8}
                className="animate-spin text-[#c9b28f]"
              />
              <p className="mt-4 text-sm text-[var(--foreground-muted)]">
                Updating generation status...
              </p>
            </div>
          )}

        {generation && isActive && (
          <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--border)] bg-[var(--surface-1)] px-6 py-4">
            <p className="text-xs text-[var(--foreground-muted)]">
              Canceling stops this generation only. You can retry it later.
            </p>

            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelGeneration.isPending}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/[0.09] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {cancelGeneration.isPending ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Ban size={15} strokeWidth={1.8} />
              )}
              {cancelGeneration.isPending ? "Canceling..." : "Cancel Generation"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
