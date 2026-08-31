"use client";

import { Check, CheckCircle2, Circle, CircleAlert, LoaderCircle } from "lucide-react";

import type { GenerationRun } from "@/types/generation";

type GeminiProgressProps = {
  generation: GenerationRun;
};

const stages = [
  {
    id: "GEMINI_STARTING",
    title: "Preparing Gemini",
    description: "Opening an independent Gemini workspace for this generation.",
  },
  {
    id: "GEMINI_GENERATING",
    title: "Generating image",
    description: "Gemini is editing your architectural render.",
  },
  {
    id: "SAVING_VERSION",
    title: "Saving version",
    description: "Downloading and attaching the generated result.",
  },
  {
    id: "DONE",
    title: "Done",
    description: "Your new render version is ready.",
  },
] as const;

function getStageIndex(stage?: string | null) {
  const index = stages.findIndex((item) => item.id === stage);

  return index === -1 ? 0 : index;
}

export function GeminiProgress({ generation }: GeminiProgressProps) {
  const failed = generation.status === "FAILED";
  const loginRequired = generation.progressStage === "GEMINI_LOGIN_REQUIRED";
  const completed = generation.status === "COMPLETED";
  const currentIndex = getStageIndex(generation.progressStage);

  if (failed) {
    return (
      <div className="flex min-h-[380px] flex-col items-center justify-center px-6 py-8 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10 text-red-400">
          <CircleAlert size={20} strokeWidth={1.8} />
        </div>

        <h3 className="mt-4 text-base font-medium">
          {loginRequired ? "Gemini connection required" : "Image generation failed"}
        </h3>

        <p className="mt-2 max-w-[480px] text-sm leading-6 text-[var(--foreground-muted)]">
          {generation.errorMessage ?? generation.progressMessage ?? "Something went wrong while generating the image."}
        </p>

        {loginRequired && (
          <p className="mt-3 text-sm text-[#c9b28f]">Reconnect Gemini from Settings, then start a new generation.</p>
        )}
      </div>
    );
  }

  return (
    <div className="px-6 py-7">
      <div className="mb-7">
        <div className="flex items-center gap-2.5">
          {completed ? (
            <CheckCircle2 size={18} strokeWidth={1.8} className="text-emerald-400" />
          ) : (
            <LoaderCircle size={18} strokeWidth={1.8} className="animate-spin text-[#c9b28f]" />
          )}

          <h3 className="text-base font-medium">{completed ? "Generation complete" : "Generating with Gemini"}</h3>
        </div>

        <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">
          {generation.progressMessage ?? "Preparing image generation..."}
        </p>
      </div>

      <div className="space-y-1">
        {stages.map((stage, index) => {
          const complete = completed || index < currentIndex;
          const active = !completed && index === currentIndex;

          return (
            <div key={stage.id} className="flex gap-3 py-3">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                {complete ? (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                    <Check size={12} strokeWidth={2.2} />
                  </div>
                ) : active ? (
                  <LoaderCircle size={17} strokeWidth={1.8} className="animate-spin text-[#c9b28f]" />
                ) : (
                  <Circle size={15} strokeWidth={1.5} className="text-white/20" />
                )}
              </div>

              <div>
                <p
                  className={[
                    "text-sm font-medium",
                    complete || active ? "text-[var(--foreground)]" : "text-[var(--foreground-subtle)]",
                  ].join(" ")}
                >
                  {stage.title}
                </p>

                <p className="mt-1 text-xs leading-5 text-[var(--foreground-muted)]">{stage.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {!completed && (
        <div className="mt-6 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
          <p className="text-xs leading-5 text-[var(--foreground-muted)]">
            This generation is independent from the others and continues in the background if you close this view.
          </p>
        </div>
      )}
    </div>
  );
}
