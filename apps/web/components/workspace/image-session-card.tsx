"use client";

import Link from "next/link";

import { getAssetUrl } from "@/lib/api";

import type { ImageSession } from "@/types/project";

type ImageSessionCardProps = {
  session: ImageSession;

  selected: boolean;

  onSelect: (sessionId: string) => void;
};

export function ImageSessionCard({ session, selected, onSelect }: ImageSessionCardProps) {
  const original = session.assets.find((asset) => asset.type === "ORIGINAL");

  if (!original) {
    return null;
  }

  return (
    <div
      className={[
        "group relative overflow-hidden rounded-[16px] border bg-[var(--surface-1)] transition-all duration-150",
        selected ? "border-[var(--foreground)]" : "border-[var(--border)] hover:border-[var(--foreground-subtle)]",
      ].join(" ")}
    >
      {/* Selection */}
      <button
        type="button"
        aria-label={selected ? "Deselect render" : "Select render"}
        onClick={() => onSelect(session.id)}
        className={[
          "absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-md",
          selected
            ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]"
            : "border-white/30 bg-black/40 text-white hover:bg-black/60",
        ].join(" ")}
      >
        {selected ? (
          <span className="text-xs font-bold">✓</span>
        ) : (
          <span className="h-2.5 w-2.5 rounded-full border border-current" />
        )}
      </button>

      <Link href={`/projects/${session.projectId}/renders/${session.id}`} className="block">
        <div className="aspect-[16/10] overflow-hidden bg-[var(--surface-2)]">
          <img
            src={getAssetUrl(original.filePath)}
            alt={session.name}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.01]"
          />
        </div>

        <div className="p-4">
          <h3 className="truncate text-sm font-medium">{session.name}</h3>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-[var(--foreground-subtle)]">Original</span>

            <span className="text-xs text-[var(--foreground-muted)]">
              {session.assets.length} {session.assets.length === 1 ? "version" : "versions"}
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}
