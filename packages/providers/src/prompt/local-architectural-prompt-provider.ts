import type { PromptGenerationInput, PromptProvider } from "./types";

function getPreservationRules(mode: PromptGenerationInput["preserveMode"]) {
  switch (mode) {
    case "STRICT":
      return `
Preserve the original image with maximum precision.

Do not change:
- architectural geometry
- building proportions
- camera position
- camera angle
- lens perspective
- composition
- openings
- structural elements
- furniture layout unless explicitly requested
- materials unless explicitly requested
- lighting unless explicitly requested

Modify only what is explicitly requested.
`;

    case "BALANCED":
      return `
Preserve the original architectural design, camera and composition.

Minor supporting improvements are allowed only when they help achieve the requested change.

Avoid unnecessary modifications to unrelated elements.
`;

    case "CREATIVE":
      return `
Preserve the core architectural identity and general composition.

Creative visual improvements are allowed when they support the requested direction, while avoiding unnecessary redesign of the architecture.
`;
  }
}

export class LocalArchitecturalPromptProvider implements PromptProvider {
  async generate(input: PromptGenerationInput): Promise<string> {
    const preservationRules = input.preserveEverythingElse
      ? getPreservationRules(input.preserveMode)
      : `
You may modify supporting visual elements when necessary to achieve the requested result.

Keep the main architectural identity recognizable unless the user explicitly requests a redesign.
`;

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
