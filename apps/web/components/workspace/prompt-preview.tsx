"use client";

import { useEffect, useState } from "react";

import { useRegeneratePrompt, useUpdatePrompt } from "@/hooks/use-prompt-generation";

import type { GenerationRun } from "@/types/generation";

type PromptPreviewProps = {
  generation: GenerationRun;

  onGenerationChange: (generation: GenerationRun) => void;
};

export function PromptPreview({ generation, onGenerationChange }: PromptPreviewProps) {
  const [prompt, setPrompt] = useState(generation.refinedPrompt ?? "");

  const regenerate = useRegeneratePrompt();

  const updatePrompt = useUpdatePrompt();

  useEffect(() => {
    setPrompt(generation.refinedPrompt ?? "");
  }, [generation]);

  const hasChanges = prompt.trim() !== (generation.refinedPrompt ?? "").trim();

  async function handleSave() {
    if (!prompt.trim()) {
      return;
    }

    const updated = await updatePrompt.mutateAsync({
      generationId: generation.id,

      prompt: prompt.trim(),
    });

    onGenerationChange(updated);
  }

  async function handleRegenerate() {
    const updated = await regenerate.mutateAsync(generation.id);

    onGenerationChange(updated);
  }

  return (
    <div className="mt-4 overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface-1)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div>
          <p className="text-xs font-medium">Nano Banana Prompt</p>

          <p className="mt-1 text-[10px] text-[var(--foreground-subtle)]">Revision {generation.promptRevision}</p>
        </div>

        <div className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--foreground-muted)]">
          Ready
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={12}
        className="w-full resize-y bg-transparent px-5 py-4 text-sm leading-6 outline-none"
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerate.isPending}
            className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-xs text-[var(--foreground-muted)] hover:bg-[var(--surface-2)] disabled:opacity-40"
          >
            {regenerate.isPending ? "Regenerating..." : "Regenerate"}
          </button>

          {hasChanges && (
            <button
              type="button"
              onClick={handleSave}
              disabled={updatePrompt.isPending}
              className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-xs hover:bg-[var(--surface-2)] disabled:opacity-40"
            >
              {updatePrompt.isPending ? "Saving..." : "Save Changes"}
            </button>
          )}
        </div>

        <button
          type="button"
          disabled
          title="Nano Banana provider will be connected next"
          className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-xs font-medium text-[var(--background)] opacity-40"
        >
          Send to Nano Banana →
        </button>
      </div>
    </div>
  );
}
