export type ImageGenerationInput = {
  sourceImagePath: string;
  prompt: string;
  outputDirectory: string;
  signal?: AbortSignal;
};

export type ImageGenerationResult = {
  absolutePath: string;
  fileName: string;
  mimeType: string;
};

export interface ImageProvider {
  generate(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}
