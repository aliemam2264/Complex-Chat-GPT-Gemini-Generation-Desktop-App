"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleX,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet } from "@/lib/api";
import { useGenerationActivityStore } from "@/stores/use-generation-activity-store";
import type { GenerationRun } from "@/types/generation";

type GenerationActivityItem = GenerationRun & {
  project: {
    id: string;
    name: string;
  };

  imageSession: {
    id: string;
    name: string;
  };

  outputAsset?: {
    id: string;
    filePath: string;
    fileName: string;
  } | null;
};

const ACTIVE_STATUSES = new Set([
  "PENDING",
  "PROMPTING",
  "PROMPT_READY",
  "GENERATING",
  "DOWNLOADING",
]);

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELED"]);
const TERMINAL_VISIBLE_MS = 10_000;

export function GenerationActivityDock() {
  const queryClient = useQueryClient();

  const [collapsed, setCollapsed] = useState(false);

  /*
   * Terminal generations dismissed manually by the user.
   *
   * Keep this local to the dock so polling can continue normally without
   * making COMPLETED / FAILED / CANCELED toasts appear again.
   */
  const [dismissedTerminalIds, setDismissedTerminalIds] = useState<Set<string>>(
    () => new Set(),
  );

  const handledCompletedIds = useRef<Set<string>>(new Set());

  const backgroundGenerationIds = useGenerationActivityStore(
    (state) => state.backgroundGenerationIds,
  );

  const removeBackgroundGeneration = useGenerationActivityStore(
    (state) => state.removeBackgroundGeneration,
  );

  const openGeneration = useGenerationActivityStore(
    (state) => state.openGeneration,
  );

  /*
   * Prompt jobs only enter the dock after the user explicitly chooses
   * "Close & continue in background". Gemini jobs are returned by the
   * backend automatically once image generation starts.
   */
  const idsParam = useMemo(() => {
    if (backgroundGenerationIds.length === 0) {
      return "";
    }

    return `?ids=${encodeURIComponent(backgroundGenerationIds.join(","))}`;
  }, [backgroundGenerationIds]);

  const activityQuery = useQuery({
    queryKey: ["generation-activity", backgroundGenerationIds],
    queryFn: () =>
      apiGet<GenerationActivityItem[]>(
        `/api/generations/activity${idsParam}`,
      ),
    refetchInterval: 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const items = activityQuery.data ?? [];

  const visibleItems = useMemo(() => {
    const now = Date.now();

    return items.filter((item) => {
      /*
       * A terminal toast that the user closed must stay hidden even though
       * /activity continues returning it for a few seconds.
       */
      if (
        TERMINAL_STATUSES.has(item.status) &&
        dismissedTerminalIds.has(item.id)
      ) {
        return false;
      }

      if (ACTIVE_STATUSES.has(item.status)) {
        return true;
      }

      if (!TERMINAL_STATUSES.has(item.status)) {
        return false;
      }

      const updatedAt = new Date(item.updatedAt).getTime();

      return now - updatedAt < TERMINAL_VISIBLE_MS;
    });
  }, [items, dismissedTerminalIds]);

  /*
   * Once an explicitly-backgrounded prompt reaches Gemini, the backend's
   * normal image-activity query keeps returning it. The local id is no
   * longer needed after that point.
   */
  useEffect(() => {
    for (const item of items) {
      if (!backgroundGenerationIds.includes(item.id)) {
        continue;
      }

      if (
        item.status === "GENERATING" ||
        item.status === "DOWNLOADING" ||
        item.status === "COMPLETED" ||
        item.status === "CANCELED" ||
        (item.status === "FAILED" &&
          item.imageProvider === "GEMINI_BROWSER")
      ) {
        removeBackgroundGeneration(item.id);
      }
    }
  }, [items, backgroundGenerationIds, removeBackgroundGeneration]);

  /*
   * A ChatGPT failure is only returned by the activity endpoint while its
   * id is explicitly backgrounded. Keep that id long enough for the error
   * toast to be visible, then clean it from the store.
   */
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const item of items) {
      if (
        item.status !== "FAILED" ||
        item.imageProvider === "GEMINI_BROWSER" ||
        !backgroundGenerationIds.includes(item.id)
      ) {
        continue;
      }

      const age = Date.now() - new Date(item.updatedAt).getTime();
      const delay = Math.max(0, TERMINAL_VISIBLE_MS - age);

      timers.push(
        setTimeout(() => {
          removeBackgroundGeneration(item.id);
        }, delay),
      );
    }

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [items, backgroundGenerationIds, removeBackgroundGeneration]);

  /*
   * Refresh a render session as soon as a background generation finishes.
   * This lets the new version appear without reopening the application.
   */
  useEffect(() => {
    for (const item of items) {
      if (
        item.status !== "COMPLETED" ||
        !item.outputAssetId ||
        handledCompletedIds.current.has(item.id)
      ) {
        continue;
      }

      handledCompletedIds.current.add(item.id);

      void queryClient.invalidateQueries({
        queryKey: ["image-session", item.imageSessionId],
      });
    }
  }, [items, queryClient]);

  function dismissTerminalGeneration(id: string) {
    setDismissedTerminalIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });

    /*
     * Also release an explicitly-backgrounded id immediately so a dismissed
     * FAILED / CANCELED prompt job cannot keep the activity query alive.
     */
    removeBackgroundGeneration(id);
  }

  if (visibleItems.length === 0) {
    return null;
  }

  const activeCount = visibleItems.filter((item) =>
    ACTIVE_STATUSES.has(item.status),
  ).length;

  const hasFailed = visibleItems.some((item) => item.status === "FAILED");
  const hasCompleted = visibleItems.some(
    (item) => item.status === "COMPLETED",
  );
  const hasCanceled = visibleItems.some(
    (item) => item.status === "CANCELED",
  );

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-5 right-5 z-[150] flex min-h-12 items-center gap-3 rounded-2xl border border-white/[0.1] bg-[#111111]/95 px-4 py-3 text-left shadow-2xl backdrop-blur-xl transition-colors hover:bg-[#161616]"
      >
        {activeCount > 0 ? (
          <LoaderCircle
            size={16}
            strokeWidth={1.8}
            className="shrink-0 animate-spin text-[#c9b28f]"
          />
        ) : hasFailed ? (
          <CircleAlert
            size={16}
            strokeWidth={1.8}
            className="shrink-0 text-red-400"
          />
        ) : hasCanceled ? (
          <CircleX
            size={16}
            strokeWidth={1.8}
            className="shrink-0 text-[var(--foreground-muted)]"
          />
        ) : (
          <CheckCircle2
            size={16}
            strokeWidth={1.8}
            className="shrink-0 text-emerald-400"
          />
        )}

        <div className="min-w-0">
          <p className="text-sm font-medium">
            {activeCount > 0
              ? `${activeCount} generation${activeCount === 1 ? "" : "s"} running`
              : hasFailed
                ? "Generation failed"
                : hasCompleted
                  ? "Generation complete"
                  : hasCanceled
                    ? "Generation canceled"
                    : "Generation activity"}
          </p>

          {activeCount > 0 && (
            <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
              Click to view active generations
            </p>
          )}
        </div>

        <ChevronUp
          size={15}
          strokeWidth={1.8}
          className="ml-1 shrink-0 text-[var(--foreground-muted)]"
        />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[150] w-[370px] overflow-hidden rounded-[18px] border border-white/[0.1] bg-[#101010]/95 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3.5">
        <div>
          <p className="text-sm font-medium">Generation Activity</p>

          <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
            {activeCount > 0
              ? `${activeCount} currently running`
              : "Recent activity"}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse generation activity"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-white/[0.05] hover:text-white"
        >
          <ChevronDown size={15} strokeWidth={1.8} />
        </button>
      </div>

      <div className="max-h-[390px] overflow-y-auto">
        {visibleItems.map((item) => (
          <ActivityItem
            key={item.id}
            item={item}
            onClick={() => openGeneration(item.id)}
            onDismissTerminal={() => dismissTerminalGeneration(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ActivityItem({
  item,
  onClick,
  onDismissTerminal,
}: {
  item: GenerationActivityItem;
  onClick: () => void;
  onDismissTerminal: () => void;
}) {
  const active = ACTIVE_STATUSES.has(item.status);
  const failed = item.status === "FAILED";
  const completed = item.status === "COMPLETED";
  const canceled = item.status === "CANCELED";
  const terminal = completed || failed || canceled;

  const buildingPrompt =
    item.status === "PENDING" ||
    item.status === "PROMPTING" ||
    item.status === "PROMPT_READY";

  const generatingImage =
    item.status === "GENERATING" || item.status === "DOWNLOADING";

  const starting =
    item.progressStage === "CHATGPT_STARTING" ||
    item.progressStage === "PROMPT_READY" ||
    item.progressStage === "GEMINI_STARTING";

  function getTitle() {
    if (completed) {
      return "Generation complete";
    }

    if (failed) {
      return "Generation failed";
    }

    if (canceled) {
      return "Generation canceled";
    }

    if (item.progressStage === "SAVING_VERSION") {
      return "Saving version";
    }

    if (buildingPrompt) {
      return item.status === "PROMPT_READY"
        ? "Starting image generation"
        : "Building prompt";
    }

    if (generatingImage) {
      return "Generating image";
    }

    return "Generation";
  }

  return (
    <div className="group relative border-b border-white/[0.06] last:border-b-0">
      {/*
       * Main row remains clickable to open GenerationInspectorModal.
       * The close X is a sibling button, not a nested button.
       */}
      <button
        type="button"
        onClick={onClick}
        className="relative block w-full px-4 py-4 text-left transition-colors hover:bg-white/[0.025]"
      >
        <div className="flex gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.025]">
            {active && (
              <LoaderCircle
                size={16}
                strokeWidth={1.8}
                className="animate-spin text-[#c9b28f]"
              />
            )}

            {completed && (
              <CheckCircle2
                size={16}
                strokeWidth={1.8}
                className="text-emerald-400"
              />
            )}

            {failed && (
              <CircleAlert
                size={16}
                strokeWidth={1.8}
                className="text-red-400"
              />
            )}

            {canceled && (
              <CircleX
                size={16}
                strokeWidth={1.8}
                className="text-[var(--foreground-muted)]"
              />
            )}
          </div>

          <div className={terminal ? "min-w-0 flex-1 pr-8" : "min-w-0 flex-1"}>
            <div className="flex items-center justify-between gap-3">
              <p
                className={[
                  "truncate text-sm font-medium",
                  failed
                    ? "text-red-400"
                    : completed
                      ? "text-emerald-400"
                      : canceled
                        ? "text-[var(--foreground-muted)]"
                        : "",
                ].join(" ")}
              >
                {getTitle()}
              </p>

              {active && (
                <span className="shrink-0 text-[11px] font-medium text-[#b8a283]">
                  {starting ? "Starting" : "Running"}
                </span>
              )}
            </div>

            <p className="mt-1 truncate text-xs text-[var(--foreground-muted)]">
              {item.imageSession.name}
              {" · "}
              {item.project.name}
            </p>

            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--foreground-subtle)]">
              {item.progressMessage ?? getDefaultMessage(item)}
            </p>

            <p className="mt-2 text-[11px] font-medium text-[#a99577] opacity-0 transition-opacity group-hover:opacity-100">
              View details
            </p>
          </div>
        </div>

        {active && (
          <div className="absolute bottom-0 left-0 right-0 h-px overflow-hidden bg-white/[0.04]">
            <div className="generation-activity-progress h-full w-[35%] bg-[#b9a17d]" />
          </div>
        )}
      </button>

      {/* All terminal jobs can be dismissed manually. */}
      {terminal && (
        <button
          type="button"
          onClick={onDismissTerminal}
          aria-label="Dismiss generation activity"
          title="Dismiss"
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

function getDefaultMessage(item: GenerationActivityItem) {
  if (item.status === "PENDING" || item.status === "PROMPTING") {
    return "ChatGPT is preparing the architectural prompt...";
  }

  if (
    item.status === "PROMPT_READY" ||
    item.progressStage === "GEMINI_STARTING"
  ) {
    return "Prompt ready. Starting Gemini...";
  }

  if (item.progressStage === "GEMINI_GENERATING") {
    return "Gemini is editing your render...";
  }

  if (item.progressStage === "SAVING_VERSION") {
    return "Saving the generated render as a new version...";
  }

  if (item.status === "COMPLETED") {
    return "Your generated render is ready.";
  }

  if (item.status === "FAILED") {
    return item.errorMessage ?? "Generation failed.";
  }

  if (item.status === "CANCELED") {
    return "Generation canceled.";
  }

  return "Working...";
}
