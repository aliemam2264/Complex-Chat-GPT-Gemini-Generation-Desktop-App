"use client";

import { useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Eye,
  History,
  LoaderCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import {
  type GenerationHistoryItem,
  useGenerationHistory,
} from "@/hooks/use-generation-history";
import { useGenerationActivityStore } from "@/stores/use-generation-activity-store";
import type { Asset } from "@/types/project";

const ACTIVE_STATUSES = new Set([
  "PENDING",
  "PROMPTING",
  "PROMPT_READY",
  "GENERATING",
  "DOWNLOADING",
]);

type Props = {
  projectId: string;
  sessionId: string;
  assets: Asset[];
  selectedSourceId: string | null;
  onSelectAsset: (assetId: string) => void;
};

type Filter = "ALL" | "COMPLETED" | "ATTENTION";

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getStatusMeta(item: GenerationHistoryItem) {
  if (item.status === "COMPLETED") {
    return {
      label: "Completed",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
      icon: CheckCircle2,
    };
  }

  if (item.status === "FAILED") {
    return {
      label: item.progressStage === "INTERRUPTED" ? "Interrupted" : "Failed",
      className: "border-red-500/20 bg-red-500/10 text-red-400",
      icon: CircleAlert,
    };
  }

  if (item.status === "CANCELED") {
    return {
      label: "Canceled",
      className: "border-white/10 bg-white/[0.04] text-white/60",
      icon: Ban,
    };
  }

  if (item.status === "GENERATING" || item.status === "DOWNLOADING") {
    return {
      label: "Generating",
      className: "border-[#b6a080]/20 bg-[#b6a080]/10 text-[#c9b28f]",
      icon: LoaderCircle,
    };
  }

  return {
    label: "Building prompt",
    className: "border-[#b6a080]/20 bg-[#b6a080]/10 text-[#c9b28f]",
    icon: LoaderCircle,
  };
}

export function GenerationHistoryPanel({
  projectId,
  sessionId,
  assets,
  selectedSourceId,
  onSelectAsset,
}: Props) {
  const historyQuery = useGenerationHistory(projectId, sessionId);
  const openGeneration = useGenerationActivityStore((state) => state.openGeneration);

  const [filter, setFilter] = useState<Filter>("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const history = historyQuery.data ?? [];

  const versionLabelById = useMemo(() => {
    const map = new Map<string, string>();
    let generatedIndex = 0;

    for (const asset of assets) {
      if (asset.type === "ORIGINAL") {
        map.set(asset.id, "Original");
        continue;
      }

      generatedIndex += 1;
      map.set(asset.id, `V${generatedIndex}`);
    }

    return map;
  }, [assets]);

  const filteredHistory = useMemo(() => {
    if (filter === "COMPLETED") {
      return history.filter((item) => item.status === "COMPLETED");
    }

    if (filter === "ATTENTION") {
      return history.filter(
        (item) => item.status === "FAILED" || item.status === "CANCELED",
      );
    }

    return history;
  }, [filter, history]);

  const visibleHistory = showAll ? filteredHistory : filteredHistory.slice(0, 6);

  function getAssetLabel(asset: Asset | null | undefined) {
    if (!asset) {
      return "—";
    }

    return versionLabelById.get(asset.id) ?? "Deleted version";
  }

  return (
    <div className="border-t border-[var(--border)] px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <History size={15} strokeWidth={1.8} className="text-[var(--foreground-muted)]" />
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--foreground-subtle)]">
              Generation History
            </p>
          </div>

          <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">
            Review every edit request, result, failure, and retry for this render.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--background)] p-1">
          {([
            ["ALL", "All"],
            ["COMPLETED", "Completed"],
            ["ATTENTION", "Needs attention"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setFilter(value);
                setShowAll(false);
              }}
              className={[
                "rounded-lg px-3 py-1.5 text-xs transition-colors",
                filter === value
                  ? "bg-[var(--surface-2)] text-[var(--foreground)]"
                  : "text-[var(--foreground-subtle)] hover:text-[var(--foreground)]",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {historyQuery.isLoading && (
        <div className="mt-4 flex min-h-[100px] items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--background)] text-sm text-[var(--foreground-muted)]">
          <LoaderCircle size={15} strokeWidth={1.8} className="mr-2 animate-spin" />
          Loading generation history...
        </div>
      )}

      {historyQuery.isError && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <CircleAlert size={16} strokeWidth={1.8} className="shrink-0 text-red-400" />
            <p className="truncate text-sm text-[var(--foreground-muted)]">
              Could not load generation history.
            </p>
          </div>

          <button
            type="button"
            onClick={() => historyQuery.refetch()}
            className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          >
            Try again
          </button>
        </div>
      )}

      {!historyQuery.isLoading && !historyQuery.isError && history.length === 0 && (
        <div className="mt-4 flex min-h-[116px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--background)] px-4 text-center">
          <Sparkles size={18} strokeWidth={1.7} className="text-[var(--foreground-subtle)]" />
          <p className="mt-2 text-sm text-[var(--foreground-muted)]">No generations yet.</p>
          <p className="mt-1 text-xs text-[var(--foreground-subtle)]">
            Your edit history will appear here after the first generation.
          </p>
        </div>
      )}

      {!historyQuery.isLoading && !historyQuery.isError && history.length > 0 && filteredHistory.length === 0 && (
        <div className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--background)] px-4 py-5 text-center text-sm text-[var(--foreground-muted)]">
          No generations match this filter.
        </div>
      )}

      {visibleHistory.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)]">
          {visibleHistory.map((item, index) => {
            const statusMeta = getStatusMeta(item);
            const StatusIcon = statusMeta.icon;
            const active = ACTIVE_STATUSES.has(item.status);
            const expanded = expandedId === item.id;
            const sourceLabel = getAssetLabel(item.sourceAsset);
            const outputLabel = getAssetLabel(item.outputAsset);
            const outputIsSelectable = Boolean(
              item.outputAssetId && assets.some((asset) => asset.id === item.outputAssetId),
            );

            return (
              <div
                key={item.id}
                className={index > 0 ? "border-t border-[var(--border-soft)]" : ""}
              >
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                    aria-label={expanded ? "Collapse generation details" : "Expand generation details"}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--foreground-subtle)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                  >
                    {expanded ? (
                      <ChevronDown size={15} strokeWidth={1.8} />
                    ) : (
                      <ChevronRight size={15} strokeWidth={1.8} />
                    )}
                  </button>

                  <div
                    className={[
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                      statusMeta.className,
                    ].join(" ")}
                  >
                    <StatusIcon
                      size={16}
                      strokeWidth={1.8}
                      className={active ? "animate-spin" : undefined}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="max-w-full truncate text-sm font-medium text-[var(--foreground)]">
                        {item.userInstruction}
                      </p>

                      <span
                        className={[
                          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          statusMeta.className,
                        ].join(" ")}
                      >
                        {statusMeta.label}
                      </span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--foreground-subtle)]">
                      <span>{sourceLabel}</span>
                      <span>→</span>
                      <span>{item.outputAsset ? outputLabel : "No output"}</span>
                      <span>·</span>
                      <span>Attempt {Math.max(1, item.attemptCount)}</span>
                      <span>·</span>
                      <span>{formatDate(item.createdAt)}</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => openGeneration(item.id)}
                    className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 text-xs text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                  >
                    <Eye size={13} strokeWidth={1.8} />
                    Inspect
                  </button>
                </div>

                {expanded && (
                  <div className="border-t border-[var(--border-soft)] bg-[var(--surface-1)] px-4 py-4">
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--background)] p-4">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--foreground-subtle)]">
                          Request
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground-muted)]">
                          {item.userInstruction}
                        </p>
                      </div>

                      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--background)] p-4">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--foreground-subtle)]">
                          Refined Prompt
                        </p>
                        <p className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap pr-2 text-sm leading-6 text-[var(--foreground-muted)]">
                          {item.refinedPrompt?.trim() || "No refined prompt was saved for this generation."}
                        </p>
                      </div>
                    </div>

                    {item.errorMessage && (
                      <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[0.04] p-4">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-red-400/80">
                          Error
                        </p>
                        <p className="mt-2 text-sm leading-6 text-red-300/80">
                          {item.errorMessage}
                        </p>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--background)] px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--foreground-subtle)]">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock3 size={12} strokeWidth={1.8} />
                          Started {item.startedAt ? formatDate(item.startedAt) : "—"}
                        </span>

                        <span>
                          Finished {item.completedAt ? formatDate(item.completedAt) : "—"}
                        </span>

                        <span>
                          {item.promptProvider ? "ChatGPT" : "Prompt —"} · {item.imageProvider ? "Gemini" : "Image —"}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {outputIsSelectable && item.outputAssetId && (
                          <button
                            type="button"
                            onClick={() => onSelectAsset(item.outputAssetId as string)}
                            className={[
                              "inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs transition-colors",
                              selectedSourceId === item.outputAssetId
                                ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]"
                                : "border-[var(--border)] text-[var(--foreground-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]",
                            ].join(" ")}
                          >
                            <Sparkles size={13} strokeWidth={1.8} />
                            {selectedSourceId === item.outputAssetId ? "Selected" : `Use ${outputLabel}`}
                          </button>
                        )}

                        {(item.status === "FAILED" || item.status === "CANCELED") && (
                          <button
                            type="button"
                            onClick={() => openGeneration(item.id)}
                            className="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                          >
                            <RotateCcw size={13} strokeWidth={1.8} />
                            Open retry
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {filteredHistory.length > 6 && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setShowAll((current) => !current)}
            className="rounded-lg px-3 py-2 text-xs text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          >
            {showAll ? "Show recent only" : `Show all ${filteredHistory.length} generations`}
          </button>
        </div>
      )}
    </div>
  );
}
