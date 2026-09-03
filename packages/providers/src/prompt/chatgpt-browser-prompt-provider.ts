import { mkdir } from "node:fs/promises";

import { chromium, type BrowserContext, type Locator, type Page } from "playwright";

import { openDetachedBrowser, requireBrowserExecutablePath } from "../browser-runtime";

import type { PromptGenerationInput, PromptProvider } from "./types";

const CHATGPT_URL = "https://chatgpt.com/";

type ChatGPTBrowserPromptProviderOptions = {
  userDataDirectory: string;
};

type ConnectionStatus = {
  connected: boolean;
  message: string;
};

export class ChatGPTLoginRequiredError extends Error {
  constructor() {
    super("ChatGPT sign in is required. Connect ChatGPT from Settings, then try again.");

    this.name = "ChatGPTLoginRequiredError";
  }
}

class ChatGPTUnexpectedVisualOutputError extends Error {
  constructor() {
    super("ChatGPT returned a visual result instead of the requested text prompt.");
    this.name = "ChatGPTUnexpectedVisualOutputError";
  }
}

export class ChatGPTBrowserPromptProvider implements PromptProvider {
  private context: BrowserContext | null = null;

  private contextPromise: Promise<BrowserContext> | null = null;

  private activeJobCount = 0;

  private readonly userDataDirectory: string;

  constructor(options: ChatGPTBrowserPromptProviderOptions) {
    this.userDataDirectory = options.userDataDirectory;
  }

  // ---------------------------------------------------------------------------
  // Browser
  // ---------------------------------------------------------------------------

  private async getContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    /*
     * Prevent two simultaneous jobs from trying
     * to launch the same persistent Chrome profile.
     */
    if (this.contextPromise) {
      return this.contextPromise;
    }

    this.contextPromise = (async () => {
      await mkdir(this.userDataDirectory, {
        recursive: true,
      });

      const executablePath = requireBrowserExecutablePath();

      console.log(`[ChatGPT] Browser executable: ${executablePath}`);
      console.log(`[ChatGPT] Profile directory: ${this.userDataDirectory}`);

      const context = await chromium.launchPersistentContext(this.userDataDirectory, {
        executablePath,
        headless: false,

        viewport: {
          width: 1440,
          height: 1000,
        },

        locale: "en-US",

        args: [
          "--profile-directory=Default",
          "--disable-blink-features=AutomationControlled",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-features=CalculateNativeWinOcclusion",
          "--lang=en-US",
          "--window-size=1440,1000",
          "--window-position=-10000,-10000",
          "--no-first-run",
          "--no-default-browser-check",
        ],
      });

      this.context = context;

      context.on("close", () => {
        if (this.context === context) {
          this.context = null;
        }
      });

      return context;
    })();

    try {
      return await this.contextPromise;
    } finally {
      this.contextPromise = null;
    }
  }

  private async createJobPage(): Promise<Page> {
    const context = await this.getContext();

    const page = await context.newPage();

    await page.goto(CHATGPT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    return page;
  }

  private async closeAutomationContext(): Promise<void> {
    if (this.contextPromise) {
      await this.contextPromise.catch(() => undefined);
    }

    const context = this.context;

    if (!context) {
      return;
    }

    /*
     * Clear the reference before close() so another caller cannot receive
     * a context that is already shutting down.
     */
    this.context = null;

    try {
      await context.close();
    } catch (error) {
      console.warn("[ChatGPT] Could not close browser context:", error);
    }
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  private async hasAuthenticatedSession(page: Page): Promise<boolean> {
    try {
      const result = await page.evaluate(async () => {
        try {
          const response = await fetch("/api/auth/session", {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          });

          if (!response.ok) {
            return {
              connected: false,
              status: response.status,
            };
          }

          const data = await response.json();

          return {
            connected: Boolean(data?.user || data?.accessToken || data?.expires),
            status: response.status,
          };
        } catch {
          return {
            connected: false,
            status: 0,
          };
        }
      });

      console.log("[ChatGPT] Session check:", result);

      return result.connected;
    } catch (error) {
      console.warn("[ChatGPT] Session check failed:", error);

      return false;
    }
  }

  private async hasAuthenticatedAccount(page: Page): Promise<boolean> {
    const selectors = [
      '[data-testid="accounts-profile-button"]',
      '[data-testid*="profile"]',
      '[aria-label="Open profile menu"]',
      'button[aria-label*="profile" i]',
      'button[aria-label*="account" i]',
      'button[aria-label*="الحساب" i]',
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count();

      for (let index = count - 1; index >= 0; index--) {
        const candidate = locator.nth(index);

        try {
          if (await candidate.isVisible()) {
            console.log(`[ChatGPT] Authenticated account control found: ${selector}`);

            return true;
          }
        } catch {
          // Try next candidate.
        }
      }
    }

    return false;
  }

  /**
   * One authentication entry point for the whole provider.
   *
   * Session endpoint is the primary signal.
   * Account UI is a fallback because ChatGPT UI/session internals can change.
   */
  private async isAuthenticated(page: Page): Promise<boolean> {
    const sessionAuthenticated = await this.hasAuthenticatedSession(page);

    if (sessionAuthenticated) {
      return true;
    }

    return this.hasAuthenticatedAccount(page);
  }

  private async ensureLoggedIn(page: Page): Promise<Locator> {
    /*
     * ChatGPT can hydrate a little after DOMContentLoaded. Use the same
     * authentication path for both status checks and real generation, and
     * wait briefly for the composer instead of failing on the first probe.
     */
    const deadline = Date.now() + 20_000;
    let authenticated = false;

    while (Date.now() < deadline) {
      authenticated = await this.isAuthenticated(page);

      if (authenticated) {
        const composer = await this.findComposer(page);

        if (composer) {
          return composer;
        }
      }

      await page.waitForTimeout(500);
    }

    if (!authenticated) {
      await this.dumpDebugInfo(page).catch(() => undefined);

      throw new ChatGPTLoginRequiredError();
    }

    throw new Error("ChatGPT is connected, but the prompt composer could not be found.");
  }

  async openManualLogin(): Promise<void> {
    /*
     * Normal Chrome and Playwright cannot safely use the same persistent
     * profile at the same time. Never reconnect while prompt jobs are active.
     */
    if (this.activeJobCount > 0) {
      throw new Error(
        `ChatGPT is currently processing ${this.activeJobCount} prompt${
          this.activeJobCount === 1 ? "" : "s"
        }. Wait for them to finish before reconnecting ChatGPT.`,
      );
    }

    await this.closeAutomationContext();

    await mkdir(this.userDataDirectory, {
      recursive: true,
    });

    const browserPath = requireBrowserExecutablePath();

    await openDetachedBrowser(browserPath, [
      `--user-data-dir=${this.userDataDirectory}`,
      "--profile-directory=Default",
      "--no-first-run",
      "--no-default-browser-check",
      CHATGPT_URL,
    ]);

    console.log("[ChatGPT] Manual login browser opened.");
  }

  async checkConnection(): Promise<ConnectionStatus> {
    let page: Page | null = null;

    try {
      console.log("[ChatGPT] Checking connection...");

      /*
       * Status checks use their own temporary page, exactly like a real job.
       * This prevents Settings from reporting a different auth result from
       * generate(), and it never touches another generation's page.
       */
      page = await this.createJobPage();

      await this.ensureLoggedIn(page);

      console.log("[ChatGPT] Connected: true");

      return {
        connected: true,
        message: "ChatGPT is connected.",
      };
    } catch (error) {
      console.error("[ChatGPT] Connection check failed:", error);

      return {
        connected: false,
        message:
          error instanceof ChatGPTLoginRequiredError
            ? "ChatGPT sign in is required."
            : error instanceof Error
              ? error.message
              : "Could not check ChatGPT connection.",
      };
    } finally {
      if (page && !page.isClosed()) {
        await page.close().catch(() => undefined);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Composer
  // ---------------------------------------------------------------------------

  private async findComposer(page: Page): Promise<Locator | null> {
    const selectors = [
      "#prompt-textarea",
      '[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Ask" i]',
      "textarea",
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count();

      for (let index = count - 1; index >= 0; index--) {
        const candidate = locator.nth(index);

        try {
          if (await candidate.isVisible()) {
            return candidate;
          }
        } catch {
          // Try next candidate.
        }
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Image Upload
  // ---------------------------------------------------------------------------

  private async getVisibleAttachmentEvidenceCount(page: Page): Promise<number> {
    const selectors = [
      'button[aria-label*="Remove file" i]',
      'button[aria-label*="Remove attachment" i]',
      'button[aria-label*="إزالة الملف"]',
      'button[aria-label*="إزالة المرفق"]',
      '[data-testid*="attachment"]',
      'img[src^="blob:"]',
    ];

    let maxVisibleCount = 0;

    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);
      let visibleCount = 0;

      for (let index = 0; index < count; index += 1) {
        if (await locator.nth(index).isVisible().catch(() => false)) {
          visibleCount += 1;
        }
      }

      maxVisibleCount = Math.max(maxVisibleCount, visibleCount);
    }

    return maxVisibleCount;
  }

  private async uploadImage(page: Page, imagePath: string, label = "source image"): Promise<void> {
    console.log(`[ChatGPT] Uploading ${label}:`, imagePath);

    const baselineAttachmentCount =
      await this.getVisibleAttachmentEvidenceCount(page);

    /*
     * ChatGPT commonly keeps a hidden file input mounted
     * around the composer.
     */
    let fileInputs = page.locator('input[type="file"]');

    if ((await fileInputs.count()) > 0) {
      await fileInputs.last().setInputFiles(imagePath);

      await this.waitForAttachment(page, label, baselineAttachmentCount);

      return;
    }

    /*
     * Fallback: open the attachment menu first.
     */
    const attachmentSelectors = [
      '[data-testid="composer-plus-btn"]',
      'button[aria-label*="Attach" i]',
      'button[aria-label*="Add files" i]',
      'button[aria-label*="Upload" i]',
      'button[aria-label*="إرفاق"]',
      'button[aria-label*="إضافة"]',
    ];

    let attachmentControlFound = false;

    for (const selector of attachmentSelectors) {
      const locator = page.locator(selector);

      if ((await locator.count()) === 0) {
        continue;
      }

      const candidate = locator.last();

      try {
        if (!(await candidate.isVisible())) {
          continue;
        }

        await candidate.click({
          force: true,
          timeout: 5000,
        });

        attachmentControlFound = true;

        console.log(`[ChatGPT] Attachment control clicked: ${selector}`);

        break;
      } catch {
        // Try next selector.
      }
    }

    if (!attachmentControlFound) {
      await this.dumpDebugInfo(page);

      throw new Error("Could not find ChatGPT image upload control.");
    }

    await page.waitForTimeout(400);

    fileInputs = page.locator('input[type="file"]');

    if ((await fileInputs.count()) === 0) {
      await this.dumpDebugInfo(page);

      throw new Error("ChatGPT attachment menu opened, but file input was not found.");
    }

    await fileInputs.last().setInputFiles(imagePath);

    await this.waitForAttachment(page, label, baselineAttachmentCount);
  }

  private async waitForAttachment(
    page: Page,
    label: string,
    baselineAttachmentCount: number,
  ): Promise<void> {
    console.log(`[ChatGPT] Waiting for ${label} attachment to finish uploading...`);

    const startedAt = Date.now();
    const deadline = startedAt + 45_000;
    let sawAttachment = false;
    let lastProgressLogAt = 0;

    const uploadBusySelectors = [
      '[aria-busy="true"]',
      '[role="progressbar"]',
      '[data-testid*="upload"][data-state="loading"]',
      '[data-testid*="attachment"][data-state="loading"]',
    ];

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        throw new Error(`ChatGPT page closed while the ${label} was uploading.`);
      }

      const bodyText = await page.locator("body").innerText().catch(() => "");
      const normalized = bodyText.toLowerCase();

      if (
        normalized.includes("failed to upload") ||
        normalized.includes("upload failed") ||
        normalized.includes("couldn't upload") ||
        normalized.includes("could not upload")
      ) {
        throw new Error(`ChatGPT failed to upload the ${label}.`);
      }

      const currentAttachmentCount =
        await this.getVisibleAttachmentEvidenceCount(page);

      const inputHasFile = await page
        .locator('input[type="file"]')
        .evaluateAll((inputs) =>
          inputs.some(
            (input) =>
              ((input as HTMLInputElement).files?.length ?? 0) > 0,
          ),
        )
        .catch(() => false);

      if (
        currentAttachmentCount > baselineAttachmentCount ||
        inputHasFile
      ) {
        sawAttachment = true;
      }

      let busy = false;
      for (const selector of uploadBusySelectors) {
        const locator = page.locator(selector);
        const count = await locator.count().catch(() => 0);

        if (count > 0) {
          for (let i = Math.max(0, count - 3); i < count; i++) {
            if (await locator.nth(i).isVisible().catch(() => false)) {
              busy = true;
              break;
            }
          }
        }

        if (busy) break;
      }

      const hasUploadingText =
        normalized.includes("uploading") ||
        normalized.includes("processing upload") ||
        normalized.includes("جارٍ التحميل") ||
        normalized.includes("جاري التحميل");

      if (sawAttachment && !busy && !hasUploadingText) {
        await page.waitForTimeout(700);
        console.log(`[ChatGPT] ${label} attachment is ready.`);
        return;
      }

      /*
       * ChatGPT can consume/reset the native file input before exposing a
       * stable attachment marker. Because setInputFiles() already succeeded, a
       * stable composer with no upload text is a safe fallback after a short
       * settle window. This is especially important for additional references,
       * where an existing source attachment must not be mistaken for the new one.
       */
      if (Date.now() - startedAt >= 4_000 && !hasUploadingText) {
        const composer = await this.findComposer(page);

        if (composer && (await composer.isVisible().catch(() => false))) {
          console.log(
            `[ChatGPT] ${label} accepted via stable composer fallback.`,
          );
          return;
        }
      }

      if (Date.now() - lastProgressLogAt >= 5_000) {
        lastProgressLogAt = Date.now();
        console.log(
          `[ChatGPT] Attachment still settling... attachment=${sawAttachment} busy=${busy} uploadingText=${hasUploadingText}`,
        );
      }

      await page.waitForTimeout(500);
    }

    // Some ChatGPT layouts expose no stable attachment marker. A long wait is
    // safer than the previous fixed 2.5s delay, especially in packaged builds.
    console.warn(
      "[ChatGPT] Attachment readiness marker was not detected before timeout; continuing after 45s settle window.",
    );
  }

  // ---------------------------------------------------------------------------
  // Architectural Prompt
  // ---------------------------------------------------------------------------

  private buildEditRequest(input: PromptGenerationInput) {
    const preserveModeText = input.preservePresetPrompt.trim();
    const unrestricted = input.preserveMode === "NO_RESTRICTION";

    const preserveEverythingText = unrestricted
      ? ""
      : input.preserveEverythingElse
        ? `
PRESERVE EVERYTHING ELSE:
Yes. Keep all unrelated parts of the image unchanged unless the user explicitly asks otherwise.
`
        : `
PRESERVE EVERYTHING ELSE:
No. You may make supporting adjustments only if they are necessary to fulfill the request, but do not introduce unrelated changes.
`;

    const preservationRules = unrestricted
      ? `
- Follow the user's requested transformation directly.
- Do not add preservation constraints beyond the selected No Restriction preset.
- Broad edits, replacements, restyling, recomposition, and structural changes are allowed when they support the request.
`
      : `
- Preserve the original composition, framing, subject identity, proportions, and visual structure unless the user explicitly asks to change them.
- Do not add unnecessary stylistic changes.
- Do not rewrite the image concept. Edit the existing image.
`;

    const referenceCount = input.referenceImages?.length ?? 0;
    const imageRoleText =
      referenceCount > 0
        ? `
ATTACHED IMAGE ROLES:
- The FIRST attached image is the SOURCE IMAGE that the downstream image model will edit.
- The next ${referenceCount} attached image${referenceCount === 1 ? " is" : "s are"} VISUAL REFERENCE IMAGE${referenceCount === 1 ? "" : "S"} only.
- Analyze the reference image${referenceCount === 1 ? "" : "s"} silently and use only the relevant visual characteristics to improve the final text prompt.
- Do NOT treat a reference image as the main image to edit.
- Do NOT copy unrelated content from a reference image into the source.
- Do NOT describe your image analysis to the user. Convert what matters directly into the final edit prompt.
`
        : "";

    return `
TEXT-ONLY PROMPT-WRITER MODE.
DO NOT generate, edit, transform, or return an image.
DO NOT invoke any image-generation or image-editing tool, even though images are attached.
The attached images are INPUTS TO ANALYZE ONLY. Another model (Gemini / Nano Banana) will perform the actual image edit later.

You are writing the final image-editing prompt that will be sent to Gemini / Nano Banana.

Your job is to inspect the uploaded source image${referenceCount > 0 ? " and visual references" : ""}, reason silently about them, and convert the user's request into one clean, precise TEXT prompt.

IMPORTANT RULES:
- Respect the actual content of the source image.
- Do NOT assume the image is architectural unless it is clearly an architectural render or the user asks for architectural changes.
- If the image is a logo, graphic, poster, product shot, portrait, illustration, or any non-architectural image, treat it accordingly.
- Do NOT invent buildings, rooms, landscapes, or architectural features unless they already exist in the image or the user explicitly requests them.
- If the user asks for a simple change (for example: change a color), then the output prompt must focus only on that change.
${preservationRules}

OUTPUT REQUIREMENTS:
- TEXT ONLY. Never return an image or visual result.
- Return exactly one final prompt as plain text.
- Do not include explanations, analysis, commentary, headings, bullet labels, or preambles.
- Do not include labels like "USER REQUEST", "ANALYSIS", "FINAL PROMPT", or "PROMPT".
- Do not say what you observed in the images separately; incorporate only relevant observations into the edit instruction.
- Write the prompt as a direct instruction for image editing.

EDIT PRESET:
${preserveModeText}

${preserveEverythingText}

${imageRoleText}
YOUR TASK:
Write a concise but strong final edit prompt for the uploaded image based on this user request:

"${input.instruction}"

The final prompt should:
- clearly state what must change
${unrestricted ? "- avoid adding preservation requirements the user did not ask for" : "- clearly state what must stay unchanged"}
- match the true type of the source image
- avoid hallucinating new content
- be suitable for Gemini / Nano Banana image editing

FINAL REMINDER: reply with the prompt TEXT ONLY. Do not create or edit an image yourself.
`.trim();
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  private async submitPrompt(page: Page, composer: Locator, prompt: string): Promise<void> {
    console.log("[ChatGPT] Entering prompt...");

    const userMessages = page.locator('[data-message-author-role="user"]');
    const initialUserCount = await userMessages.count().catch(() => 0);

    await composer.click({ force: true });
    await composer.fill(prompt);

    const sendSelectors = [
      '[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="إرسال"]',
      'button[type="submit"]',
    ];

    const deadline = Date.now() + 35_000;
    let selectedSendButton: Locator | null = null;

    while (Date.now() < deadline && !selectedSendButton) {
      for (const selector of sendSelectors) {
        const locator = page.locator(selector);
        const count = await locator.count().catch(() => 0);

        for (let index = count - 1; index >= 0; index--) {
          const candidate = locator.nth(index);
          const visible = await candidate.isVisible().catch(() => false);
          const disabled = await candidate.isDisabled().catch(() => true);

          if (visible && !disabled) {
            selectedSendButton = candidate;
            break;
          }
        }

        if (selectedSendButton) break;
      }

      if (!selectedSendButton) {
        await page.waitForTimeout(500);
      }
    }

    if (selectedSendButton) {
      await selectedSendButton.click({ force: true, timeout: 5000 });
      console.log("[ChatGPT] Send button clicked. Verifying submission...");
    } else {
      console.warn("[ChatGPT] Send button never became enabled. Trying Enter fallback.");
      await composer.press("Enter");
    }

    const verifyDeadline = Date.now() + 12_000;

    while (Date.now() < verifyDeadline) {
      const currentUserCount = await userMessages.count().catch(() => 0);
      const composerText = (await composer.innerText().catch(() => "")).trim();

      if (currentUserCount > initialUserCount || composerText.length === 0) {
        console.log("[ChatGPT] Prompt submission confirmed.");
        return;
      }

      await page.waitForTimeout(400);
    }

    console.warn("[ChatGPT] First submit attempt was not confirmed. Retrying with Enter...");
    await composer.press("Enter").catch(() => undefined);

    const retryDeadline = Date.now() + 8_000;
    while (Date.now() < retryDeadline) {
      const currentUserCount = await userMessages.count().catch(() => 0);
      const composerText = (await composer.innerText().catch(() => "")).trim();

      if (currentUserCount > initialUserCount || composerText.length === 0) {
        console.log("[ChatGPT] Prompt submission confirmed after retry.");
        return;
      }

      await page.waitForTimeout(400);
    }

    await this.dumpDebugInfo(page).catch(() => undefined);
    throw new Error("ChatGPT prompt could not be submitted after the image upload finished.");
  }

  // ---------------------------------------------------------------------------
  // Assistant Response
  // ---------------------------------------------------------------------------

  private async readConversationApiAssistant(page: Page): Promise<string> {
    const match = page.url().match(/\/c\/([^/?#]+)/);

    if (!match?.[1]) {
      return "";
    }

    const conversationId = match[1];

    return page
      .evaluate(async (id) => {
        try {
          const response = await fetch(`/backend-api/conversation/${id}`, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          });

          if (!response.ok) {
            return "";
          }

          const data = await response.json();
          const mapping = data?.mapping && typeof data.mapping === "object" ? Object.values(data.mapping) : [];

          const assistantMessages = mapping
            .map((node: any) => node?.message)
            .filter((message: any) => message?.author?.role === "assistant")
            .sort((a: any, b: any) => Number(a?.create_time ?? 0) - Number(b?.create_time ?? 0));

          const last = assistantMessages.at(-1);
          const parts = Array.isArray(last?.content?.parts) ? last.content.parts : [];

          return parts
            .filter((part: unknown) => typeof part === "string")
            .join("\n")
            .trim();
        } catch {
          return "";
        }
      }, conversationId)
      .catch(() => "");
  }

  private async waitForAssistantResponse(
    page: Page,
    initialAssistantCount: number,
    initialAssistantText: string,
    initialTurnCount: number,
    timeoutMs = 90_000,
  ): Promise<string> {
    console.log("[ChatGPT] Waiting for prompt result...");

    /*
     * ChatGPT has changed its conversation DOM more than once.
     * Do not rely on data-message-author-role alone. The current UI can render
     * conversation turns without that attribute, which made production wait
     * forever even though the response was already visible.
     */
    const assistantMessages = page.locator(
      [
        '[data-message-author-role="assistant"]',
        '[data-turn="assistant"]',
        'article[data-turn="assistant"]',
      ].join(","),
    );

    const conversationTurns = page.locator('article[data-testid^="conversation-turn-"]');
    const fallbackConversationTurns = page.locator('[data-testid^="conversation-turn-"]');

    const deadline = Date.now() + timeoutMs;
    let previousCandidate = "";
    let stableIterations = 0;
    let lastProgressLogAt = 0;
    let lastApiProbeAt = 0;
    let visualOutputFirstSeenAt: number | null = null;

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        throw new Error("ChatGPT page closed while waiting for the refined prompt.");
      }

      const count = await assistantMessages.count().catch(() => 0);
      let text = "";
      let source = "none";

      if (count > 0) {
        const lastMessage = assistantMessages.last();
        const markdown = lastMessage.locator(".markdown");

        if ((await markdown.count().catch(() => 0)) > 0) {
          text = (await markdown.last().innerText().catch(() => "")).trim();
        } else {
          text = (await lastMessage.innerText().catch(() => "")).trim();
        }

        if (text) {
          source = "assistant-role";
        }
      }

      let turnCount = await conversationTurns.count().catch(() => 0);
      let turns = conversationTurns;

      if (turnCount === 0) {
        turns = fallbackConversationTurns;
        turnCount = await turns.count().catch(() => 0);
      }

      /*
       * A successful submit adds a user turn first and then an assistant turn.
       * If there are at least two new turns, the newest turn is the assistant
       * response even when ChatGPT no longer exposes data-message-author-role.
       */
      let latestAssistantTurnHasVisualOutput = false;

      if (turnCount >= initialTurnCount + 2) {
        const candidate = turns.last();
        const candidateText = (await candidate.innerText().catch(() => "")).trim();
        const imageCount = await candidate.locator("img").count().catch(() => 0);

        latestAssistantTurnHasVisualOutput = imageCount > 0;

        if (!text && candidateText.length > 30) {
          text = candidateText;
          source = "conversation-turn";
        }
      }

      /*
       * Final fallback: read the authenticated conversation JSON. This avoids
       * DOM-selector drift entirely when the server has already stored the
       * assistant response. Probe only every few seconds.
       */
      if (!text && Date.now() - lastApiProbeAt >= 5_000) {
        lastApiProbeAt = Date.now();
        const apiText = await this.readConversationApiAssistant(page);

        if (apiText.length > 30 && apiText !== initialAssistantText) {
          text = apiText;
          source = "conversation-api";
        }
      }

      const stopButton = page.locator(
        [
          '[data-testid="stop-button"]',
          'button[aria-label*="Stop" i]',
          'button[aria-label*="إيقاف"]',
        ].join(","),
      );

      const generating =
        (await stopButton.count().catch(() => 0)) > 0 &&
        (await stopButton.last().isVisible().catch(() => false));

      if (latestAssistantTurnHasVisualOutput) {
        visualOutputFirstSeenAt ??= Date.now();

        // Give ChatGPT a brief chance to finish a tool card. Once generation
        // has stopped and the newest assistant turn still contains an image,
        // treat it as the wrong response type and recover with a text-only turn.
        if (!generating && Date.now() - visualOutputFirstSeenAt >= 2_000) {
          console.warn("[ChatGPT] Visual output detected instead of text prompt.");
          throw new ChatGPTUnexpectedVisualOutputError();
        }
      } else {
        visualOutputFirstSeenAt = null;
      }

      const isNewResponse =
        text.length > 30 &&
        (count > initialAssistantCount || text !== initialAssistantText);

      if (isNewResponse && !latestAssistantTurnHasVisualOutput) {
        if (text === previousCandidate) {
          stableIterations += 1;
        } else {
          previousCandidate = text;
          stableIterations = 0;
          console.log(`[ChatGPT] Response candidate detected via ${source}.`);
        }

        if (stableIterations >= 2 && !generating) {
          console.log(`[ChatGPT] Prompt result received via ${source}.`);
          return text;
        }
      }

      const bodyText = await page.locator("body").innerText().catch(() => "");
      const normalized = bodyText.toLowerCase();

      if (
        normalized.includes("something went wrong") ||
        normalized.includes("there was an error generating a response") ||
        normalized.includes("error in message stream") ||
        normalized.includes("network error") ||
        normalized.includes("حدث خطأ")
      ) {
        throw new Error("ChatGPT returned an error while refining the prompt.");
      }

      if (Date.now() - lastProgressLogAt >= 10_000) {
        lastProgressLogAt = Date.now();
        console.log(
          `[ChatGPT] Still waiting for response... assistantCount=${count} initial=${initialAssistantCount} turnCount=${turnCount} initialTurns=${initialTurnCount} textLength=${text.length}`,
        );
      }

      await page.waitForTimeout(1000);
    }

    await this.dumpDebugInfo(page).catch(() => undefined);
    throw new Error(
      `ChatGPT prompt generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
    );
  }

  private cleanResponse(text: string): string {
    return text
      .replace(/^```(?:text|markdown)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .replace(/^\s*(?:final\s+prompt|prompt)\s*:\s*/i, "")
      .trim();
  }

  // ---------------------------------------------------------------------------
  // Generate
  // ---------------------------------------------------------------------------

  async generate(input: PromptGenerationInput): Promise<string> {
    let page: Page | null = null;
    let abortHandler: (() => void) | null = null;

    this.activeJobCount += 1;

    try {
      if (input.signal?.aborted) {
        throw new Error("Generation canceled.");
      }

      console.log(`[ChatGPT] Starting independent prompt generation. Active jobs: ${this.activeJobCount}`);

      await input.onProgress?.({
        stage: "CHATGPT_STARTING",
        message: "Preparing ChatGPT...",
      });

      /*
       * Every generation owns a separate page. The BrowserContext is shared
       * only so every page can reuse the same authenticated Chrome profile.
       */
      page = await this.createJobPage();

      if (input.signal) {
        abortHandler = () => {
          if (page && !page.isClosed()) {
            void page.close().catch(() => undefined);
          }
        };

        input.signal.addEventListener("abort", abortHandler, { once: true });

        if (input.signal.aborted) {
          abortHandler();
          throw new Error("Generation canceled.");
        }
      }

      await this.ensureLoggedIn(page);

      await input.onProgress?.({
        stage: "CHATGPT_UPLOADING_IMAGE",
        message: "Uploading source image to ChatGPT...",
      });

      await this.uploadImage(page, input.sourceImagePath, "source image");

      const referenceImages = input.referenceImages ?? [];

      for (let index = 0; index < referenceImages.length; index += 1) {
        const referenceImage = referenceImages[index];

        if (!referenceImage) {
          continue;
        }

        await input.onProgress?.({
          stage: "CHATGPT_UPLOADING_IMAGE",
          message: `Uploading reference image ${index + 1} of ${referenceImages.length} to ChatGPT...`,
        });

        await this.uploadImage(
          page,
          referenceImage.path,
          `reference image ${index + 1}/${referenceImages.length}`,
        );
      }

      const composer = await this.findComposer(page);

      if (!composer) {
        throw new Error("ChatGPT composer disappeared after attaching the source image.");
      }

      const assistantMessages = page.locator('[data-message-author-role="assistant"]');
      const initialAssistantCount = await assistantMessages.count();
      const initialAssistantText =
        initialAssistantCount > 0
          ? (await assistantMessages.last().innerText().catch(() => "")).trim()
          : "";

      let conversationTurns = page.locator('article[data-testid^="conversation-turn-"]');
      let initialTurnCount = await conversationTurns.count().catch(() => 0);

      if (initialTurnCount === 0) {
        conversationTurns = page.locator('[data-testid^="conversation-turn-"]');
        initialTurnCount = await conversationTurns.count().catch(() => 0);
      }

      console.log(
        `[ChatGPT] Response baseline: assistantCount=${initialAssistantCount} turnCount=${initialTurnCount}`,
      );

      const request = this.buildEditRequest(input);

      await this.submitPrompt(page, composer, request);

      await input.onProgress?.({
        stage: "CHATGPT_WAITING_RESPONSE",
        message: "ChatGPT is analyzing the render and building the prompt...",
      });

      const responseTimeoutMs = referenceImages.length > 0 ? 210_000 : 90_000;

      let response: string;

      try {
        response = await this.waitForAssistantResponse(
          page,
          initialAssistantCount,
          initialAssistantText,
          initialTurnCount,
          responseTimeoutMs,
        );
      } catch (error) {
        if (!(error instanceof ChatGPTUnexpectedVisualOutputError)) {
          throw error;
        }

        console.warn(
          "[ChatGPT] Recovering from unexpected visual response with a text-only follow-up.",
        );

        await input.onProgress?.({
          stage: "CHATGPT_WAITING_RESPONSE",
          message: "ChatGPT returned a visual result. Requesting the text prompt only...",
        });

        const recoveryComposer = await this.findComposer(page);
        if (!recoveryComposer) {
          throw new Error("ChatGPT returned an image instead of a prompt, and the composer could not be found for recovery.");
        }

        const recoveryAssistantMessages = page.locator('[data-message-author-role="assistant"]');
        const recoveryAssistantCount = await recoveryAssistantMessages.count().catch(() => 0);
        const recoveryAssistantText =
          recoveryAssistantCount > 0
            ? (await recoveryAssistantMessages.last().innerText().catch(() => "")).trim()
            : "";

        let recoveryTurns = page.locator('article[data-testid^="conversation-turn-"]');
        let recoveryTurnCount = await recoveryTurns.count().catch(() => 0);
        if (recoveryTurnCount === 0) {
          recoveryTurns = page.locator('[data-testid^="conversation-turn-"]');
          recoveryTurnCount = await recoveryTurns.count().catch(() => 0);
        }

        await this.submitPrompt(
          page,
          recoveryComposer,
          [
            "TEXT ONLY. Do not generate or edit an image.",
            "Your previous response was a visual result, but I need only the final image-editing prompt for another model.",
            "Using the same source image, reference images, user request, and preservation rules from the previous turn, return exactly one plain-text edit prompt.",
            "No explanation, no analysis, no heading, no label, and no image output.",
          ].join(" "),
        );

        response = await this.waitForAssistantResponse(
          page,
          recoveryAssistantCount,
          recoveryAssistantText,
          recoveryTurnCount,
          120_000,
        );
      }

      const cleaned = this.cleanResponse(response);

      if (!cleaned) {
        throw new Error("ChatGPT returned an empty prompt.");
      }

      return cleaned;
    } finally {
      if (input.signal && abortHandler) {
        input.signal.removeEventListener("abort", abortHandler);
      }

      if (page && !page.isClosed()) {
        await page.close().catch(() => undefined);
      }

      this.activeJobCount = Math.max(0, this.activeJobCount - 1);

      console.log(`[ChatGPT] Independent prompt generation finished. Active jobs: ${this.activeJobCount}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  private async dumpDebugInfo(page: Page): Promise<void> {
    console.log("========== CHATGPT DEBUG ==========");

    console.log("[ChatGPT] URL:", page.url());

    console.log("[ChatGPT] Title:", await page.title().catch(() => ""));

    const composerCount = await page
      .locator(["#prompt-textarea", '[contenteditable="true"][role="textbox"]', "textarea"].join(","))
      .count()
      .catch(() => 0);

    console.log("[ChatGPT] Composer count:", composerCount);

    const controls = await page
      .locator('input, textarea, [contenteditable="true"], button, a, [role="button"]')
      .evaluateAll((elements) =>
        elements.slice(-120).map((element) => ({
          tag: element.tagName,
          id: element.getAttribute("id"),
          type: element.getAttribute("type"),
          href: element.getAttribute("href"),
          ariaLabel: element.getAttribute("aria-label"),
          dataTestId: element.getAttribute("data-testid"),
          text: element.textContent?.trim().slice(0, 120) ?? "",
        })),
      )
      .catch(() => []);

    console.log("[ChatGPT] Controls:", controls);

    console.log("===================================");
  }
}
