export type PreserveMode = "STRICT" | "BALANCED" | "CREATIVE";

export type PromptGenerationInput = {
  instruction: string;

  preserveMode: PreserveMode;

  preserveEverythingElse: boolean;

  sourceImagePath: string;

  sourceMimeType: string;

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
