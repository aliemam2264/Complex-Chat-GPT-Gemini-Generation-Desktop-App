export type PreserveMode = "STRICT" | "BALANCED" | "CREATIVE" | "NO_RESTRICTION";

export type PromptReferenceImage = {
  path: string;
  fileName: string;
  mimeType: string;
};

export type PromptGenerationInput = {
  instruction: string;

  preserveMode: PreserveMode;

  preserveEverythingElse: boolean;

  preservePresetPrompt: string;

  sourceImagePath: string;

  sourceMimeType: string;

  referenceImages?: PromptReferenceImage[];

  onProgress?: (progress: PromptProgressUpdate) => void | Promise<void>;

  signal?: AbortSignal;
};

export interface PromptProvider {
  generate(input: PromptGenerationInput): Promise<string>;
}

export type PromptProgressUpdate = {
  stage: "CHATGPT_STARTING" | "CHATGPT_UPLOADING_IMAGE" | "CHATGPT_WAITING_RESPONSE";

  message: string;
};
