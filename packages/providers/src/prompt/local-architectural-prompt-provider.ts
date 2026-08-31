import type { PromptGenerationInput, PromptProvider } from "./types";

function getPreservationRules(input: PromptGenerationInput) {
  if (input.preserveMode === "NO_RESTRICTION") {
    return input.preservePresetPrompt;
  }

  if (input.preserveEverythingElse) {
    return input.preservePresetPrompt;
  }

  return `
You may modify supporting visual elements when necessary to achieve the requested result.

Keep the main visual identity recognizable unless the user explicitly requests a redesign.
`;
}

export class LocalArchitecturalPromptProvider implements PromptProvider {
  async generate(input: PromptGenerationInput): Promise<string> {
    const preservationRules = getPreservationRules(input);

    return `
Use the provided image as the primary visual reference.

USER REQUEST:
${input.instruction}

ARCHITECTURAL PRESERVATION:
${preservationRules}

IMAGE EDITING REQUIREMENTS:
- Work directly from the supplied source image.
- Maintain realistic architectural visualization quality.
- Maintain physically believable materials and lighting.
- Avoid introducing visual artifacts.
- Avoid distorted geometry.
- Avoid unrealistic textures or repeated patterns.
- Keep perspective consistent with the source image.
- Preserve realistic scale between architectural elements, vegetation, people and furniture.
- Make modifications look naturally integrated into the existing render.
- Do not add text, logos or watermarks.
- Produce a high-quality photorealistic result.

Apply the requested change precisely while keeping all unrelated elements visually consistent with the source image.
`.trim();
  }
}
