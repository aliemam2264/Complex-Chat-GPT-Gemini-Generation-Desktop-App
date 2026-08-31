"use client";

import type { LucideIcon } from "lucide-react";
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";

type ProviderStatus = "connected" | "disconnected" | "checking";

type ProviderCardProps = {
  icon: LucideIcon;
  name: string;
  description: string;
  status: ProviderStatus;

  actionLabel?: string;
  actionLoading?: boolean;

  onAction?: () => void;
};

export function ProviderCard({
  icon: Icon,
  name,
  description,
  status,
  actionLabel,
  actionLoading = false,
  onAction,
}: ProviderCardProps) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
          <Icon size={19} strokeWidth={1.8} />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-sm font-medium">{name}</h3>

            {status === "checking" && (
              <div className="inline-flex items-center gap-1.5 text-xs text-[var(--foreground-muted)]">
                <LoaderCircle size={13} className="animate-spin" />
                Checking
              </div>
            )}

            {status === "connected" && (
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                <CheckCircle2 size={14} strokeWidth={2} />
                Connected
              </div>
            )}

            {status === "disconnected" && (
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-red-500">
                <CircleAlert size={14} strokeWidth={2} />
                Not connected
              </div>
            )}
          </div>

          <p className="mt-1 text-xs leading-5 text-[var(--foreground-muted)]">{description}</p>
        </div>
      </div>

      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          disabled={actionLoading}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3.5 text-xs text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {actionLoading && <LoaderCircle size={14} className="animate-spin" />}

          {!actionLoading && <RefreshCw size={14} strokeWidth={1.8} />}

          {actionLoading ? "Please wait..." : actionLabel}
        </button>
      )}
    </div>
  );
}
