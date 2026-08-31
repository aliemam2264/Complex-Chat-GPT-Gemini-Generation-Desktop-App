import type { Asset } from "./project";

export type NanoBananaResult = {
  generation: GenerationRun;

  asset: Asset;
};

export type PreserveMode = "STRICT" | "BALANCED" | "CREATIVE";

export type GenerationStatus =
  "PENDING" | "PROMPTING" | "PROMPT_READY" | "GENERATING" | "DOWNLOADING" | "COMPLETED" | "FAILED" | "CANCELED";

export type GenerationRun = {
  id: string;

  projectId: string;
  imageSessionId: string;
  sourceAssetId: string;

  outputAssetId: string | null;

  userInstruction: string;
  refinedPrompt: string | null;

  preserveMode: "STRICT" | "BALANCED" | "CREATIVE";
  preserveEverythingElse: boolean;

  promptRevision: number;

  promptProvider: "LOCAL" | "CHATGPT_BROWSER" | "GEMINI_BROWSER" | "OPENAI_API" | "GEMINI_API" | null;

  imageProvider: "LOCAL" | "CHATGPT_BROWSER" | "GEMINI_BROWSER" | "OPENAI_API" | "GEMINI_API" | null;

  status: "PENDING" | "PROMPTING" | "PROMPT_READY" | "GENERATING" | "DOWNLOADING" | "COMPLETED" | "FAILED" | "CANCELED";

  progressStage: string | null;
  progressMessage: string | null;

  errorMessage: string | null;

  attemptCount: number;
  lastAttemptAt: string | null;

  cancelRequestedAt: string | null;
  canceledAt: string | null;

  startedAt: string | null;
  completedAt: string | null;

  createdAt: string;
  updatedAt: string;
};
