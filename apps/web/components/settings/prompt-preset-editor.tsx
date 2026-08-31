"use client";

import { useEffect, useState } from "react";

import { LoaderCircle, RotateCcw, Save } from "lucide-react";

import type { PromptPreset } from "@/hooks/use-prompt-presets";

type PromptPresetEditorProps = {
  preset: PromptPreset;
  saving: boolean;
  resetting: boolean;
  onSave: (prompt: string) => Promise<void>;
  onReset: () => Promise<void>;
};

export function PromptPresetEditor({
  preset,
  saving,
  resetting,
  onSave,
  onReset,
}: PromptPresetEditorProps) {
  const [draft, setDraft] = useState(preset.effectivePrompt);

  useEffect(() => {
    setDraft(preset.effectivePrompt);
  }, [preset.effectivePrompt]);

  const normalizedDraft = draft.trim();
  const dirty = normalizedDraft !== preset.effectivePrompt.trim();
  const canSave = normalizedDraft.length > 0 && dirty && !saving && !resetting;
  const canReset =
    (preset.isCustomized || normalizedDraft !== preset.defaultPrompt.trim()) &&
    !saving &&
    !resetting;

  async function handleSave() {
    if (!canSave) {
      return;
    }

    await onSave(normalizedDraft);
  }

  async function handleReset() {
    if (!canReset) {
      return;
    }

    if (preset.isCustomized) {
      await onReset();
      return;
    }

    setDraft(preset.defaultPrompt);
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{preset.label}</h3>

            <span className="rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[10px] text-[var(--foreground-subtle)]">
              {preset.isCustomized ? "Custom" : "Default"}
            </span>
          </div>

          <p className="mt-1 text-xs leading-5 text-[var(--foreground-muted)]">
            {preset.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={!canReset}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 text-xs text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            {resetting ? (
              <LoaderCircle size={13} strokeWidth={1.8} className="animate-spin" />
            ) : (
              <RotateCcw size={13} strokeWidth={1.8} />
            )}
            Reset to Default
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-[var(--foreground)] px-3.5 text-xs font-medium text-[var(--background)] transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
          >
            {saving ? (
              <LoaderCircle size={13} strokeWidth={1.8} className="animate-spin" />
            ) : (
              <Save size={13} strokeWidth={1.8} />
            )}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={5}
        maxLength={6000}
        spellCheck={false}
        className="mt-4 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-xs leading-5 text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--foreground-subtle)] focus:border-[var(--foreground-subtle)]"
      />

      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-[var(--foreground-subtle)]">
        <span>
          {preset.isCustomized
            ? "This user override replaces the hardcoded preset."
            : "Using the hardcoded preset shipped with Eskander Plus Studio."}
        </span>
        <span>{draft.length}/6000</span>
      </div>
    </div>
  );
}
