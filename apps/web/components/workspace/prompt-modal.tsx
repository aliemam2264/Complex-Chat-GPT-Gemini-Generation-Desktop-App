"use client";

import { useEffect, useState } from "react";

import { Ban, CheckCircle2, CircleAlert, LoaderCircle, Minimize2, RotateCcw, X } from "lucide-react";

import { GeminiProgress } from "@/components/generation/gemini-progress";
import { PromptProgress } from "@/components/generation/prompt-progress";

import { useCancelGeneration, useRetryGeneration } from "@/hooks/use-prompt-generation";

import type { GenerationRun } from "@/types/generation";

type PromptModalProps = {
  open: boolean;

  generation: GenerationRun | null;

  starting?: boolean;

  onClose: () => void;

  onGenerationChange: (generation: GenerationRun) => void;
};

export function PromptModal({ open, generation, starting = false, onClose, onGenerationChange }: PromptModalProps) {
  const [providerMessage, setProviderMessage] = useState<string | null>(null);

  const retryGeneration = useRetryGeneration();
  const cancelGeneration = useCancelGeneration();

  /*
   * Clear old local errors when we switch
   * to another generation.
   */
  useEffect(() => {
    setProviderMessage(null);
  }, [generation?.id]);

  /*
   * Escape only closes the view.
   *
   * It DOES NOT cancel the backend job.
   */
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        /*
         * During the very tiny window before
         * the GenerationRun exists, avoid closing.
         *
         * Once we have generation.id the parent
         * can safely move it to background activity.
         */
        if (starting && !generation) {
          return;
        }

        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, starting, generation]);

  if (!open) {
    return null;
  }

  /*
   * POST /prompts was fired but the API has
   * not returned the GenerationRun yet.
   */
  const waitingForGeneration = starting && !generation;

  /*
   * ChatGPT phase.
   */
  const promptRunning = starting || generation?.status === "PENDING" || generation?.status === "PROMPTING";

  /*
   * PROMPT_READY is now only a hand-off state.
   *
   * Backend should move:
   *
   * PROMPT_READY
   *      ↓
   * GEMINI_QUEUED
   *
   * automatically.
   */
  const promptReady = generation?.status === "PROMPT_READY";

  /*
   * Gemini phase.
   */
  const generatingImage = generation?.status === "GENERATING" || generation?.status === "DOWNLOADING";

  const imageCompleted = generation?.status === "COMPLETED";

  const canceled = generation?.status === "CANCELED";

  /*
   * Detect which part of the pipeline failed.
   *
   * Don't rely only on progressStage === FAILED,
   * because both ChatGPT and Gemini may use it.
   */
  const geminiFailed =
    generation?.status === "FAILED" &&
    Boolean(
      generation.imageProvider === "GEMINI_BROWSER" ||
      generation.progressStage?.startsWith("GEMINI_") ||
      generation.progressStage === "SAVING_VERSION",
    );

  const promptFailed = generation?.status === "FAILED" && !geminiFailed;

  const promptPhase = waitingForGeneration || promptRunning || promptReady;

  async function handleRetryGeneration() {
    if (!generation) {
      return;
    }

    setProviderMessage(null);

    try {
      const updated = await retryGeneration.mutateAsync(generation.id);
      onGenerationChange(updated);
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Could not retry generation.");
    }
  }

  async function handleCancelGeneration() {
    if (!generation) {
      return;
    }

    setProviderMessage(null);

    try {
      const updated = await cancelGeneration.mutateAsync(generation.id);
      onGenerationChange(updated);
    } catch (error) {
      setProviderMessage(error instanceof Error ? error.message : "Could not cancel generation.");
    }
  }

  function getHeaderState() {
    if (canceled) {
      return {
        title: "Generation Canceled",
        label: "Canceled",
        labelClassName: "border-white/10 bg-white/[0.04] text-white/60",
      };
    }

    if (imageCompleted) {
      return {
        title: "Generation Complete",
        label: "Done",
        labelClassName: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
      };
    }

    if (geminiFailed) {
      return {
        title: "Generate Image",
        label: "Failed",
        labelClassName: "border-red-500/20 bg-red-500/10 text-red-400",
      };
    }

    if (promptFailed) {
      return {
        title: "Build Prompt",
        label: "Failed",
        labelClassName: "border-red-500/20 bg-red-500/10 text-red-400",
      };
    }

    if (generatingImage) {
      return {
        title: "Generating Image",
        label: "Gemini",
        labelClassName: "border-[#b6a080]/20 bg-[#b6a080]/10 text-[#c9b28f]",
      };
    }

    if (promptReady) {
      return {
        title: "Build Prompt",
        label: "Ready",
        labelClassName: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
      };
    }

    if (promptRunning) {
      return {
        title: "Build Prompt",
        label: "Working",
        labelClassName: "border-[#b6a080]/20 bg-[#b6a080]/10 text-[#c9b28f]",
      };
    }

    return {
      title: "Build Prompt",
      label: "Preparing",
      labelClassName: "border-[var(--border)] text-[var(--foreground-muted)]",
    };
  }

  const headerState = getHeaderState();

  /*
   * Don't allow backgrounding until we actually
   * know which GenerationRun should be tracked.
   */
  const canContinueInBackground = Boolean(generation?.id);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-6 backdrop-blur-[3px]">
      <div className="flex max-h-[88vh] w-full max-w-[900px] flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-5">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-base font-medium">{headerState.title}</h2>

              <span
                className={["rounded-full border px-2.5 py-1 text-xs font-medium", headerState.labelClassName].join(
                  " ",
                )}
              >
                {headerState.label}
              </span>
            </div>

            {generation && (
              <p className="mt-1.5 text-xs text-[var(--foreground-subtle)]">Generation #{generation.id.slice(-6)}</p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={starting && !generation}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        {/* --------------------------------------------------------------- */}
        {/* Prompt Phase                                                    */}
        {/* --------------------------------------------------------------- */}

        {promptPhase && (
          <>
            {waitingForGeneration ? (
              <PromptProgress starting />
            ) : (
              <PromptProgress generation={generation ?? undefined} />
            )}

            {promptReady && (
              <div className="border-t border-white/[0.06] px-6 py-4">
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] px-4 py-3">
                  <CheckCircle2 size={17} strokeWidth={1.8} className="shrink-0 text-emerald-400" />

                  <div>
                    <p className="text-sm font-medium">Prompt ready</p>

                    <p className="mt-1 text-xs text-[var(--foreground-muted)]">Starting Gemini automatically...</p>
                  </div>

                  <LoaderCircle size={15} strokeWidth={1.8} className="ml-auto animate-spin text-[#c9b28f]" />
                </div>
              </div>
            )}

            {/* Background action belongs HERE */}
            <div className="flex shrink-0 items-center justify-between gap-5 border-t border-[var(--border)] bg-[var(--surface-1)] px-6 py-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">You don't need to wait</p>

                <p className="mt-1 max-w-[500px] text-xs leading-5 text-[var(--foreground-muted)]">
                  ChatGPT will finish the prompt and Gemini will generate the image automatically.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelGeneration}
                  disabled={!generation || cancelGeneration.isPending}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/[0.08] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {cancelGeneration.isPending ? (
                    <LoaderCircle size={15} className="animate-spin" />
                  ) : (
                    <Ban size={15} strokeWidth={1.8} />
                  )}
                  {cancelGeneration.isPending ? "Canceling..." : "Cancel"}
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  disabled={!canContinueInBackground}
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <Minimize2 size={15} strokeWidth={1.8} />
                  Close & continue in background
                </button>
              </div>
            </div>
          </>
        )}

        {/* --------------------------------------------------------------- */}
        {/* Prompt Failure                                                  */}
        {/* --------------------------------------------------------------- */}

        {promptFailed && generation && (
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 text-red-400">
                <CircleAlert size={20} strokeWidth={1.8} />
              </div>

              <h3 className="mt-4 text-base font-medium">Prompt generation failed</h3>

              <p className="mt-2 max-w-[500px] text-sm leading-6 text-[var(--foreground-muted)]">
                {generation.errorMessage ??
                  generation.progressMessage ??
                  "Something went wrong while building the prompt."}
              </p>

              {generation.progressStage === "CHATGPT_LOGIN_REQUIRED" && (
                <p className="mt-3 text-sm text-[#c9b28f]">Reconnect ChatGPT from Settings, then try again.</p>
              )}

              <button
                type="button"
                onClick={handleRetryGeneration}
                disabled={retryGeneration.isPending}
                className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {retryGeneration.isPending ? (
                  <LoaderCircle size={15} strokeWidth={1.8} className="animate-spin" />
                ) : (
                  <RotateCcw size={15} strokeWidth={1.8} />
                )}

                {retryGeneration.isPending ? "Retrying..." : "Retry Generation"}
              </button>

              {providerMessage && <p className="mt-4 max-w-[500px] text-sm text-[var(--danger)]">{providerMessage}</p>}
            </div>
          </div>
        )}

        {/* --------------------------------------------------------------- */}
        {/* Gemini Phase                                                    */}
        {/* --------------------------------------------------------------- */}

        {generation && generatingImage && (
          <>
            <GeminiProgress generation={generation} />

            <div className="flex shrink-0 justify-end border-t border-[var(--border)] px-6 py-4">
              <button
                type="button"
                onClick={handleCancelGeneration}
                disabled={cancelGeneration.isPending}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {cancelGeneration.isPending ? (
                  <LoaderCircle size={15} className="animate-spin" />
                ) : (
                  <Ban size={15} strokeWidth={1.8} />
                )}
                {cancelGeneration.isPending ? "Canceling..." : "Cancel Generation"}
              </button>
            </div>
          </>
        )}

        {/* --------------------------------------------------------------- */}
        {/* Gemini Failure                                                  */}
        {/* --------------------------------------------------------------- */}

        {generation && geminiFailed && (
          <>
            <GeminiProgress generation={generation} />

            <div className="flex shrink-0 justify-end border-t border-[var(--border)] px-6 py-4">
              <button
                type="button"
                onClick={handleRetryGeneration}
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
            </div>
          </>
        )}

        {/* --------------------------------------------------------------- */}
        {/* Canceled                                                        */}
        {/* --------------------------------------------------------------- */}

        {generation && canceled && (
          <div className="flex min-h-[380px] flex-col items-center justify-center px-6 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/60">
              <Ban size={22} strokeWidth={1.8} />
            </div>

            <h3 className="mt-5 text-base font-medium">Generation canceled</h3>

            <p className="mt-2 max-w-[460px] text-sm leading-6 text-[var(--foreground-muted)]">
              This generation was stopped before completion. You can retry it whenever you want.
            </p>

            <div className="mt-6 flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-[var(--border)] px-4 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
              >
                Close
              </button>

              <button
                type="button"
                onClick={handleRetryGeneration}
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
            </div>
          </div>
        )}

        {/* --------------------------------------------------------------- */}
        {/* Completed                                                       */}
        {/* --------------------------------------------------------------- */}

        {generation && imageCompleted && (
          <div className="flex min-h-[380px] flex-col items-center justify-center px-6 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 size={22} strokeWidth={1.8} />
            </div>

            <h3 className="mt-5 text-base font-medium">Generation complete</h3>

            <p className="mt-2 max-w-[460px] text-sm leading-6 text-[var(--foreground-muted)]">
              Your generated render has been saved as a new version.
            </p>

            <button
              type="button"
              onClick={onClose}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-xl bg-white px-5 text-sm font-medium text-black transition-opacity hover:opacity-90"
            >
              Done
            </button>
          </div>
        )}

        {/* --------------------------------------------------------------- */}
        {/* Empty / first milliseconds                                     */}
        {/* --------------------------------------------------------------- */}

        {!starting && !generation && (
          <div className="flex min-h-[320px] items-center justify-center p-6">
            <LoaderCircle size={18} strokeWidth={1.8} className="mr-2 animate-spin text-[#c9b28f]" />

            <p className="text-sm text-[var(--foreground-muted)]">Preparing generation...</p>
          </div>
        )}
      </div>
    </div>
  );
}
