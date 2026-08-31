"use client";

import { Check, Circle, LoaderCircle } from "lucide-react";

import type { GenerationRun } from "@/types/generation";

type PromptProgressProps = {
  generation?: GenerationRun;
  starting?: boolean;
};

const stages = [
  {
    id: "CHATGPT_STARTING",
    title: "Preparing ChatGPT",
    description: "Starting the architectural prompt workspace.",
  },

  {
    id: "CHATGPT_UPLOADING_IMAGE",
    title: "Uploading source render",
    description: "Sending the selected image to ChatGPT.",
  },

  {
    id: "CHATGPT_WAITING_RESPONSE",
    title: "Building architectural prompt",
    description: "Analyzing your instruction and the source render.",
  },

  {
    id: "PROMPT_READY",
    title: "Prompt ready",
    description: "The prompt is ready and Gemini will start automatically.",
  },
] as const;

function getStageIndex(stage?: string | null) {
  if (!stage) {
    return 0;
  }

  const index = stages.findIndex((item) => item.id === stage);

  return index === -1 ? 0 : index;
}

export function PromptProgress({ generation, starting = false }: PromptProgressProps) {
  const currentIndex = getStageIndex(generation?.progressStage);

  return (
    <div className="px-6 py-7">
      <div className="mb-7">
        <div className="flex items-center gap-2.5">
          <LoaderCircle size={17} strokeWidth={1.8} className="animate-spin text-[#b6a080]" />

          <h3 className="text-[15px] font-medium">Building Prompt</h3>
        </div>

        <p className="mt-2 text-[13px] leading-6 text-[var(--foreground-muted)]">
          {starting ? "Preparing your generation job..." : (generation?.progressMessage ?? "Preparing ChatGPT...")}
        </p>
      </div>

      <div className="space-y-1">
        {stages.map((stage, index) => {
          const complete = index < currentIndex;

          const active = index === currentIndex;

          return (
            <div key={stage.id} className="flex gap-3 py-3">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                {complete ? (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                    <Check size={12} strokeWidth={2.2} />
                  </div>
                ) : active ? (
                  <LoaderCircle size={17} strokeWidth={1.8} className="animate-spin text-[#b6a080]" />
                ) : (
                  <Circle size={15} strokeWidth={1.5} className="text-white/20" />
                )}
              </div>

              <div>
                <p
                  className={[
                    "text-[13px] font-medium",
                    complete || active ? "text-[var(--foreground)]" : "text-[var(--foreground-subtle)]",
                  ].join(" ")}
                >
                  {stage.title}
                </p>

                <p className="mt-1 text-[12px] leading-5 text-[var(--foreground-muted)]">{stage.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
        <p className="text-[12px] leading-5 text-[var(--foreground-muted)]">
          ChatGPT is working in the background. You don't need to open ChatGPT manually.
        </p>
      </div>
    </div>
  );
}
