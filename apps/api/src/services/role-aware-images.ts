import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";

import { getStorageRoot } from "../config/storage";

type ImageDescriptor = {
  absolutePath: string;
  mimeType?: string | null;
};

const extensionByMimeType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function extensionFor(image: ImageDescriptor) {
  const known = image.mimeType ? extensionByMimeType[image.mimeType] : undefined;
  return known ?? (extname(image.absolutePath) || ".png");
}

export async function stageRoleAwareImages(input: {
  source: ImageDescriptor;
  references?: ImageDescriptor[];
}) {
  const directory = join(getStorageRoot(), "provider-staging", randomUUID());
  await mkdir(directory, { recursive: true });

  const sourcePath = join(directory, `source${extensionFor(input.source)}`);
  await copyFile(input.source.absolutePath, sourcePath);

  const referencePaths: string[] = [];
  for (let index = 0; index < (input.references ?? []).length; index += 1) {
    const reference = input.references![index]!;
    const referencePath = join(directory, `ref ${index + 1}${extensionFor(reference)}`);
    await copyFile(reference.absolutePath, referencePath);
    referencePaths.push(referencePath);
  }

  return {
    sourcePath,
    referencePaths,
    cleanup: () => rm(directory, { recursive: true, force: true }).catch(() => undefined),
  };
}

export function buildRoleAwareImagePrompt(prompt: string, referenceCount: number) {
  const referenceNames = Array.from({ length: referenceCount }, (_, index) => `ref ${index + 1}`).join(", ");
  return `
IMAGE ROLE CONTRACT — FOLLOW EXACTLY:
- The file named "source" is the ONLY image you may edit or transform.
- ${referenceCount > 0 ? `The files named ${referenceNames} are REFERENCES ONLY.` : "There are no reference images for this request."}
- Never replace the source with a reference image.
- Never edit, return, or treat any reference image as the source.
- References may only guide requested visual details such as style, material, pose, lighting, composition cues, or other explicitly requested attributes.
- Preserve everything in the source that the instruction does not explicitly ask to change.
- Return one final image derived from the source image.

EDIT INSTRUCTION:
${prompt.trim()}
`.trim();
}
