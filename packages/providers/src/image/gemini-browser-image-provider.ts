import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { basename, extname, join } from "node:path";

import { chromium, type BrowserContext, type Locator, type Page, type Response as PlaywrightResponse } from "playwright";

import type { ImageGenerationInput, ImageGenerationResult, ImageProvider } from "./types";

import { openDetachedBrowser, requireBrowserExecutablePath } from "../browser-runtime";

export class GeminiLoginRequiredError extends Error {
  constructor() {
    super("Gemini sign in is required. Reconnect Gemini from Settings, then try again.");

    this.name = "GeminiLoginRequiredError";
  }
}

type GeminiBrowserImageProviderOptions = {
  userDataDirectory: string;
};

const GEMINI_URL = "https://gemini.google.com/app";
const DEFAULT_GENERATION_TIMEOUT_MS = 4 * 60 * 1000;
const GENERATED_IMAGE_DOWNLOAD_GRACE_MS = 15_000;

type GeneratedImageSnapshot = {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
};

type GeneratedImageCandidate = {
  image: Locator;
  signature: string;
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  scopedToModelResponse: boolean;
};

type GeneratedImageDetection = {
  downloadButton: Locator | null;
  image: Locator | null;
  snapshot: GeneratedImageSnapshot | null;
  detectedBy: "download-button" | "generated-image" | "network-image";
};

type NetworkImageCandidate = {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  byteLength: number;
  url: string;
  capturedAt: number;
};

type GeneratedImageNetworkCapture = {
  arm: () => void;
  getBest: () => NetworkImageCandidate | null;
  stop: () => void;
};

export class GeminiBrowserImageProvider implements ImageProvider {
  private context: BrowserContext | null = null;
  private contextPromise: Promise<BrowserContext> | null = null;
  private activeJobCount = 0;
  private readonly userDataDirectory: string;

  constructor(options: GeminiBrowserImageProviderOptions) {
    this.userDataDirectory = options.userDataDirectory;
  }

  private async getContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    if (this.contextPromise) {
      return this.contextPromise;
    }

    this.contextPromise = (async () => {
      await mkdir(this.userDataDirectory, {
        recursive: true,
      });

      const executablePath = requireBrowserExecutablePath();

      console.log("[Gemini] Browser executable:", executablePath);
      console.log("[Gemini] Profile directory:", this.userDataDirectory);

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

    await page.goto(GEMINI_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    return page;
  }

  private async findComposer(page: Page) {
    const selectors = [
      "div.ql-editor",

      'rich-textarea [contenteditable="true"]',

      '[contenteditable="true"][role="textbox"]',

      '[aria-label="Enter a prompt here"]',

      '[aria-label="أدخل طلبًا هنا"]',

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
          // Try next.
        }
      }
    }

    return null;
  }

  private async hasGoogleSession(page: Page): Promise<boolean> {
    try {
      const cookies = await page.context().cookies();

      const authenticatedCookieNames = new Set([
        "SID",
        "HSID",
        "SSID",
        "APISID",
        "SAPISID",
        "__Secure-1PSID",
        "__Secure-3PSID",
      ]);

      return cookies.some((cookie) => {
        const googleCookie =
          cookie.domain.includes("google.") || cookie.domain.endsWith("google.com") || cookie.domain.endsWith("google.com.eg");

        return googleCookie && authenticatedCookieNames.has(cookie.name);
      });
    } catch (error) {
      console.warn("[Gemini] Could not inspect Google session cookies:", error);

      return false;
    }
  }

  private async hasVisibleAccountControl(page: Page): Promise<boolean> {
    const selectors = [
      "gem-icon-button.mavatar-settings-button",
      '[aria-label*="Google Account" i]',
      '[aria-label*="Google account" i]',
      '[aria-label*="حساب Google"]',
      '[aria-label*="الحساب"]',
      '[data-test-id*="account"]',
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);

      for (let index = count - 1; index >= 0; index--) {
        try {
          if (await locator.nth(index).isVisible()) {
            return true;
          }
        } catch {
          // Try the next candidate.
        }
      }
    }

    return false;
  }

  private async hasVisibleSignInControl(page: Page): Promise<boolean> {
    const selectors = [
      'button:has-text("Sign in")',
      'a:has-text("Sign in")',
      'button:has-text("تسجيل الدخول")',
      'a:has-text("تسجيل الدخول")',
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);

      for (let index = count - 1; index >= 0; index--) {
        try {
          if (await locator.nth(index).isVisible()) {
            return true;
          }
        } catch {
          // Try the next candidate.
        }
      }
    }

    return false;
  }

  private async ensureLoggedIn(page: Page): Promise<Locator> {
    /*
     * IMPORTANT:
     * Generic Google SID/APISID cookies are NOT sufficient proof that Gemini
     * itself is signed in. A dedicated Chrome profile can still contain Google
     * cookies while gemini.google.com visibly shows "Sign in".
     *
     * Production was previously accepting that false-positive state, which let
     * upload/prompt automation continue on Gemini's signed-out landing page.
     *
     * A visible Sign in control is therefore authoritative after a short
     * hydration grace period.
     */
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);

    const deadline = Date.now() + 25_000;
    let signInVisibleSince: number | null = null;

    while (Date.now() < deadline) {
      const composer = await this.findComposer(page);
      const [hasGoogleSession, hasAccountControl, hasSignInControl] =
        await Promise.all([
          this.hasGoogleSession(page),
          this.hasVisibleAccountControl(page),
          this.hasVisibleSignInControl(page),
        ]);

      if (hasSignInControl) {
        if (signInVisibleSince === null) {
          signInVisibleSince = Date.now();
        }

        /*
         * Gemini can flash a signed-out shell during hydration, so allow a
         * small grace period. If Sign in remains visible for 2.5 seconds and
         * no authenticated account control appeared, the profile is signed out.
         */
        if (
          Date.now() - signInVisibleSince >= 2_500 &&
          !hasAccountControl
        ) {
          console.warn(
            "[Gemini] Visible Sign in control persisted. Treating the dedicated Gemini profile as disconnected.",
          );

          throw new GeminiLoginRequiredError();
        }

        await page.waitForTimeout(250);
        continue;
      }

      signInVisibleSince = null;

      /*
       * Strongest positive signal: a usable composer plus Gemini's authenticated
       * account control, with no visible Sign in button.
       */
      if (composer && hasAccountControl) {
        return composer;
      }

      /*
       * Fallback for Gemini variants where the account avatar hydrates late:
       * composer + persisted Google session is accepted ONLY when Sign in is not
       * visible. Recheck once after a short quiet period before continuing.
       */
      if (composer && hasGoogleSession) {
        await page.waitForTimeout(750);

        const [composerStillVisible, signInStillVisible] = await Promise.all([
          composer.isVisible().catch(() => false),
          this.hasVisibleSignInControl(page),
        ]);

        if (composerStillVisible && !signInStillVisible) {
          return composer;
        }
      }

      /*
       * Last-resort UI signal. Some Gemini accounts expose neither the expected
       * cookie names nor the account selector, but a stable composer with no
       * Sign in UI is still a usable authenticated workspace.
       */
      if (composer && !hasSignInControl) {
        await page.waitForTimeout(1_000);

        const [composerStillVisible, signInStillVisible] = await Promise.all([
          composer.isVisible().catch(() => false),
          this.hasVisibleSignInControl(page),
        ]);

        if (composerStillVisible && !signInStillVisible) {
          return composer;
        }
      }

      await page.waitForTimeout(500);
    }

    const hasSignInControl = await this.hasVisibleSignInControl(page);

    if (hasSignInControl) {
      throw new GeminiLoginRequiredError();
    }

    throw new Error(
      `Gemini session could not become ready. Current URL: ${page.url()}`,
    );
  }

  private async startFreshChat(page: Page) {
    const candidates = [
      page.getByRole("button", {
        name: /new chat|start new chat|محادثة جديدة|بدء محادثة جديدة/i,
      }),
      page.getByRole("link", {
        name: /new chat|start new chat|محادثة جديدة|بدء محادثة جديدة/i,
      }),
    ];

    for (const locator of candidates) {
      const count = await locator.count();

      for (let index = 0; index < count; index++) {
        const candidate = locator.nth(index);

        try {
          if (!(await candidate.isVisible())) {
            continue;
          }

          await candidate.click({
            timeout: 4000,
          });

          await page.waitForLoadState("domcontentloaded").catch(() => undefined);

          return;
        } catch {
          // Try another candidate.
        }
      }
    }

    /*
     * A newly-created page is already isolated from
     * the other jobs. If Gemini doesn't expose a
     * New chat control, navigating to the app root is
     * the safest fallback for a clean workspace.
     */
    await page.goto(GEMINI_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  }

  private async waitForUploadToSettle(
    page: Page,
    baselineAttachmentCount = 0,
    baselineVisibleImageCount = 0,
    baselineSendUsable = false,
    label = "source image",
  ) {
    console.log(`[Gemini] Waiting for ${label} attachment upload...`);

    /*
     * Gemini's attachment DOM changes frequently. In the current UI the image
     * can be visibly ready in the composer while the old attachment selectors
     * report zero items, or while a stale progress element remains mounted.
     *
     * We therefore combine four independent signals:
     *  1. known attachment DOM,
     *  2. a newly visible image thumbnail,
     *  3. the native file input still holding the file,
     *  4. a usable Send control / stable composer after file selection.
     *
     * The file chooser / setInputFiles call has already succeeded before this
     * method runs, so a usable Send control is strong evidence that Gemini has
     * accepted the attachment even when its private upload DOM is opaque.
     */
    await page.bringToFront().catch(() => undefined);

    const startedAt = Date.now();
    const deadline = startedAt + 60_000;

    let explicitReadySince: number | null = null;
    let sendReadySince: number | null = null;
    let quietComposerSince: number | null = null;
    let sawExplicitAttachment = false;
    let sawLoading = false;
    let lastProgressLogAt = 0;

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        throw new Error(
          `Gemini browser page closed while the ${label} was uploading.`,
        );
      }

      const state = await page
        .evaluate(() => {
          const bodyText = (document.body?.innerText ?? "").toLowerCase();

          const loadingSelectors = [
            ".gem-attachment-content.loading",
            '.gem-attachment-content [aria-busy="true"]',
            '[class*="attachment"][class*="loading"]',
            '[data-test-id*="attachment"][aria-busy="true"]',
            '[data-testid*="attachment"][aria-busy="true"]',
            'images-files-uploader [aria-busy="true"]',
          ];

          const attachmentSelectors = [
            ".gem-attachment-content",
            '[class*="attachment"] img',
            '[class*="attachment"] [aria-label*="remove" i]',
            '[data-test-id*="attachment"]',
            '[data-testid*="attachment"]',
            '[data-test-id*="uploaded"]',
            '[data-testid*="uploaded"]',
            "file-preview",
            "image-preview",
            'img[src^="blob:"]',
          ];

          const composerSelectors = [
            "div.ql-editor",
            'rich-textarea [contenteditable="true"]',
            '[contenteditable="true"][role="textbox"]',
            '[aria-label="Enter a prompt here"]',
            '[aria-label="أدخل طلبًا هنا"]',
            '[aria-label*="Ask Gemini" i]',
            '[aria-label*="Gemini" i][contenteditable="true"]',
            "textarea",
          ];

          const isVisible = (element: Element) => {
            const html = element as HTMLElement;
            const rect = html.getBoundingClientRect();
            const style = window.getComputedStyle(html);

            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden"
            );
          };

          const countVisible = (selectors: string[]) =>
            selectors.reduce(
              (total, selector) =>
                total +
                Array.from(document.querySelectorAll(selector)).filter(isVisible)
                  .length,
              0,
            );

          const loadingCount = countVisible(loadingSelectors);
          const attachmentCount = countVisible(attachmentSelectors);
          const composerVisible = composerSelectors.some((selector) =>
            Array.from(document.querySelectorAll(selector)).some(isVisible),
          );

          const visibleImageCount = Array.from(
            document.querySelectorAll<HTMLImageElement>("img"),
          ).filter((image) => {
            if (!isVisible(image)) {
              return false;
            }

            const rect = image.getBoundingClientRect();

            /*
             * Ignore tiny icons / tracking images. Attachment thumbnails in
             * Gemini are materially larger than this. The baseline captured
             * before file selection protects us from account avatars/logos.
             */
            return rect.width >= 32 && rect.height >= 32;
          }).length;

          const inputHasFile = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
          ).some((input) => (input.files?.length ?? 0) > 0);

          const uploadError =
            bodyText.includes("failed to upload") ||
            bodyText.includes("upload failed") ||
            bodyText.includes("couldn't upload") ||
            bodyText.includes("could not upload") ||
            bodyText.includes("unsupported file") ||
            bodyText.includes("file is too large") ||
            bodyText.includes("تعذر تحميل") ||
            bodyText.includes("فشل تحميل");

          return {
            loadingCount,
            attachmentCount,
            visibleImageCount,
            inputHasFile,
            composerVisible,
            uploadError,
          };
        })
        .catch(() => ({
          loadingCount: 0,
          attachmentCount: 0,
          visibleImageCount: 0,
          inputHasFile: false,
          composerVisible: false,
          uploadError: false,
        }));

      if (state.uploadError) {
        await this.dumpUploadDebugInfo(page).catch(() => undefined);
        throw new Error(`Gemini reported that the ${label} upload failed.`);
      }

      if (state.loadingCount > 0) {
        sawLoading = true;
      }

      const sendUsable = await this.isSendControlUsable(page);
      const composer = await this.findComposer(page);
      const composerUsable =
        state.composerVisible ||
        (composer ? await composer.isVisible().catch(() => false) : false);

      const newAttachmentDom =
        state.attachmentCount > baselineAttachmentCount;
      const newImageThumbnail =
        state.visibleImageCount > baselineVisibleImageCount;

      if (newAttachmentDom || newImageThumbnail || state.inputHasFile) {
        sawExplicitAttachment = true;
      }

      const uploadIdle = state.loadingCount === 0;
      const explicitEvidence =
        newAttachmentDom || newImageThumbnail || state.inputHasFile;

      /*
       * Strongest path: a new attachment / thumbnail exists. If Gemini's Send
       * control is usable, let that override a stale loading node that remains
       * mounted after the actual upload has completed.
       */
      const explicitReady =
        explicitEvidence && (uploadIdle || sendUsable);

      if (explicitReady) {
        if (explicitReadySince === null) {
          explicitReadySince = Date.now();
        }

        if (Date.now() - explicitReadySince >= 750) {
          console.log(
            `[Gemini] ${label} ready via attachment evidence. ` +
              `attachments=${state.attachmentCount} images=${state.visibleImageCount} ` +
              `inputHasFile=${state.inputHasFile} sendUsable=${sendUsable}.`,
          );
          return;
        }
      } else {
        explicitReadySince = null;
      }

      /*
       * Current Gemini UI: attaching an image can enable the blue Send arrow
       * even though the attachment itself lives in private DOM that none of our
       * selectors can see. The screenshot from the failing run shows exactly
       * this state: thumbnail visible + active Send arrow, while the old detector
       * kept waiting.
       */
      const sendBecameUsable = sendUsable && !baselineSendUsable;

      if (sendBecameUsable) {
        if (sendReadySince === null) {
          sendReadySince = Date.now();
        }

        if (Date.now() - sendReadySince >= 750) {
          console.log(
            `[Gemini] ${label} ready because the Send control became usable after file selection.`,
          );
          return;
        }
      } else {
        sendReadySince = null;
      }

      const elapsed = Date.now() - startedAt;

      /*
       * For additional reference images the Send control may already be usable
       * because the source image is attached. In that case accept a stable
       * composer after a conservative quiet window. submitPrompt() performs its
       * own verified send/retry handshake, so this fallback cannot silently mark
       * the generation successful; it merely stops a false upload timeout.
       */
      const quietFallbackEligible =
        elapsed >= 5_000 && sendUsable && !state.uploadError;

      if (quietFallbackEligible) {
        if (quietComposerSince === null) {
          quietComposerSince = Date.now();
        }

        if (Date.now() - quietComposerSince >= 1_500) {
          console.log(
            `[Gemini] ${label} accepted via stable composer/send fallback. ` +
              `explicitAttachmentSeen=${sawExplicitAttachment} loadingSeen=${sawLoading}.`,
          );
          return;
        }
      } else {
        quietComposerSince = null;
      }

      if (Date.now() - lastProgressLogAt >= 5_000) {
        lastProgressLogAt = Date.now();
        console.log(
          `[Gemini] Upload state: label=${label} elapsed=${Math.round(elapsed / 1000)}s ` +
            `loading=${state.loadingCount} attachments=${state.attachmentCount} ` +
            `images=${state.visibleImageCount} inputHasFile=${state.inputHasFile} ` +
            `composerUsable=${composerUsable} sendUsable=${sendUsable}.`,
        );
      }

      await page.waitForTimeout(250);
    }

    await this.dumpUploadDebugInfo(page).catch(() => undefined);

    throw new Error(
      `Gemini ${label} upload never reached a usable state. ` +
        "The file picker succeeded, but Gemini never exposed a usable composer/send state.",
    );
  }

  private async isSendControlUsable(page: Page): Promise<boolean> {
    const control = await this.findVisibleSendControl(page);

    if (!control) {
      return false;
    }

    return control
      .evaluate((element) => {
        const html = element as HTMLElement;
        const ariaDisabled = html.getAttribute("aria-disabled");
        const disabledAttribute = html.hasAttribute("disabled");
        const className = (html.getAttribute("class") ?? "").toLowerCase();

        const container = html.closest(
          '[data-test-id="send-button-container"], [data-testid="send-button-container"]',
        );

        const containerDisabled =
          container?.getAttribute("aria-disabled") === "true" ||
          container?.hasAttribute("disabled") === true;

        return (
          ariaDisabled !== "true" &&
          !disabledAttribute &&
          !containerDisabled &&
          !className.includes("disabled")
        );
      })
      .catch(() => false);
  }

  private async dumpUploadDebugInfo(page: Page) {
    console.log("========== GEMINI UPLOAD DEBUG ==========");

    console.log("[Gemini] URL:", page.url());

    console.log("[Gemini] Title:", await page.title().catch(() => ""));

    const customButtons = await page
      .locator("gem-icon-button")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          arialabel: element.getAttribute("arialabel"),
          ariaLabel: element.getAttribute("aria-label"),
          className: element.getAttribute("class"),
          text: element.textContent?.trim(),
        })),
      )
      .catch(() => []);

    console.log("[Gemini] gem-icon-button elements:", customButtons);

    const normalButtons = await page
      .locator("button")
      .evaluateAll((elements) =>
        elements
          .map((element) => ({
            ariaLabel: element.getAttribute("aria-label"),
            title: element.getAttribute("title"),
            text: element.textContent?.trim(),
          }))
          .filter((item) => item.ariaLabel || item.title || item.text)
          .slice(-60),
      )
      .catch(() => []);

    console.log("[Gemini] normal buttons:", normalButtons);

    const uploadElements = await page
      .locator('input[type="file"], images-files-uploader, [data-test-id*="upload"], [data-test-id*="file"]')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          tag: element.tagName,
          dataTestId: element.getAttribute("data-test-id"),
          ariaLabel: element.getAttribute("aria-label"),
          className: element.getAttribute("class"),
        })),
      )
      .catch(() => []);

    console.log("[Gemini] upload-related DOM:", uploadElements);

    console.log("=========================================");
  }

  private async dumpOpenMenuDebugInfo(page: Page) {
    console.log("========== GEMINI OPEN MENU DEBUG ==========");

    const visibleText = await page
      .locator('[role="menuitem"], [role="menu"], mat-action-list, .mat-mdc-menu-content, .mat-mdc-menu-item')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          tag: element.tagName,
          text: element.textContent?.trim() ?? "",
          ariaLabel: element.getAttribute("aria-label"),
          role: element.getAttribute("role"),
          dataTestId: element.getAttribute("data-test-id"),
          className: element.getAttribute("class"),
        })),
      )
      .catch(() => []);

    console.log("[Gemini] Open menu elements:", visibleText);

    const dataTestElements = await page
      .locator("[data-test-id]")
      .evaluateAll((elements) =>
        elements
          .map((element) => ({
            tag: element.tagName,
            dataTestId: element.getAttribute("data-test-id"),
            text: element.textContent?.trim() ?? "",
          }))
          .filter((element) => {
            const value = element.dataTestId?.toLowerCase() ?? "";

            return value.includes("upload") || value.includes("file") || value.includes("image");
          }),
      )
      .catch(() => []);

    console.log("[Gemini] Upload data-test elements:", dataTestElements);

    console.log("=============================================");
  }

  private async findExistingUploadMenuItem(page: Page) {
    const selectors = [
      '[data-test-id="uploader-images-files-button-advanced"]',
      '[data-test-id="local-images-files-uploader-button"]',

      '[role="menuitem"]:has-text("تحميل الملفات")',
      '[role="menuitem"]:has-text("تحميل ملفات")',

      '[role="menuitem"]:has-text("Upload files")',
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector);

      if ((await locator.count()) === 0) {
        continue;
      }

      const candidate = locator.last();

      try {
        if (await candidate.isVisible()) {
          return candidate;
        }
      } catch {
        // Continue.
      }
    }

    return null;
  }

  private async getVisibleAttachmentEvidenceCount(page: Page): Promise<number> {
    return page
      .evaluate(() => {
        const selectors = [
          ".gem-attachment-content",
          '[class*="attachment"] img',
          '[class*="attachment"] [aria-label*="remove" i]',
          '[data-test-id*="attachment"]',
          '[data-testid*="attachment"]',
          '[data-test-id*="uploaded"]',
          '[data-testid*="uploaded"]',
          "file-preview",
          "image-preview",
          'img[src^="blob:"]',
        ];

        const isVisible = (element: Element) => {
          const html = element as HTMLElement;
          const rect = html.getBoundingClientRect();
          const style = window.getComputedStyle(html);

          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        };

        return selectors.reduce(
          (total, selector) =>
            total +
            Array.from(document.querySelectorAll(selector)).filter(isVisible)
              .length,
          0,
        );
      })
      .catch(() => 0);
  }

  private async getVisibleImageEvidenceCount(page: Page): Promise<number> {
    return page
      .evaluate(() => {
        const isVisible = (element: Element) => {
          const html = element as HTMLElement;
          const rect = html.getBoundingClientRect();
          const style = window.getComputedStyle(html);

          return (
            rect.width >= 32 &&
            rect.height >= 32 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        };

        return Array.from(document.querySelectorAll<HTMLImageElement>("img")).filter(
          isVisible,
        ).length;
      })
      .catch(() => 0);
  }

  private async uploadImage(
    page: Page,
    imagePath: string,
    label = "source image",
  ) {
    console.log(`[Gemini] Starting ${label} upload...`);

    /*
     * A Chromium window parked far off-screen can be treated as occluded by
     * Windows/Chrome despite throttling flags. Keep the job page foregrounded
     * during the upload handshake.
     */
    await page.bringToFront().catch(() => undefined);
    await page.waitForTimeout(1000);

    const [baselineAttachmentCount, baselineVisibleImageCount, baselineSendUsable] =
      await Promise.all([
        this.getVisibleAttachmentEvidenceCount(page),
        this.getVisibleImageEvidenceCount(page),
        this.isSendControlUsable(page),
      ]);

    const alreadyOpenUploadItem = await this.findExistingUploadMenuItem(page);

    if (alreadyOpenUploadItem) {
      console.log("[Gemini] Upload menu is already open.");

      const fileChooserPromise = page
        .waitForEvent("filechooser", {
          timeout: 5000,
        })
        .catch(() => null);

      await alreadyOpenUploadItem.click({
        force: true,
      });

      const fileChooser = await fileChooserPromise;

      if (fileChooser) {
        await fileChooser.setFiles(imagePath);

        await this.waitForUploadToSettle(
          page,
          baselineAttachmentCount,
          baselineVisibleImageCount,
          baselineSendUsable,
          label,
        );

        return;
      }

      await page.waitForTimeout(300);

      const input = page.locator('input[type="file"]');

      if ((await input.count()) > 0) {
        await input.last().setInputFiles(imagePath);

        await this.waitForUploadToSettle(
          page,
          baselineAttachmentCount,
          baselineVisibleImageCount,
          baselineSendUsable,
          label,
        );

        return;
      }
    }

    /*
     * 1. Sometimes Gemini already has a file input.
     */
    const existingInput = page.locator('input[type="file"]');

    if ((await existingInput.count()) > 0) {
      console.log("[Gemini] Existing file input found.");

      await existingInput.last().setInputFiles(imagePath);

      await this.waitForUploadToSettle(
          page,
          baselineAttachmentCount,
          baselineVisibleImageCount,
          baselineSendUsable,
          label,
        );

      return;
    }

    /*
     * 2. Open Upload & Tools.
     *
     * Support both Arabic and English Gemini UI.
     */
    const triggerSelectors = [
      // Arabic
      'gem-icon-button[arialabel="التحميل والأدوات"]',
      'gem-icon-button[aria-label="التحميل والأدوات"]',
      'button[aria-label="التحميل والأدوات"]',

      // English
      'gem-icon-button[arialabel="Upload and tools"]',
      'gem-icon-button[arialabel="Upload & tools"]',
      'gem-icon-button[aria-label="Upload and tools"]',
      'gem-icon-button[aria-label="Upload & tools"]',
      'button[aria-label="Upload and tools"]',
      'button[aria-label="Upload & tools"]',

      // Old Gemini
      'button[aria-label="Open upload file menu"]',

      /*
       * Structural fallback.
       * We already know from your DOM that this is the
       * composer tools button.
       */
      "gem-icon-button.menu-button.gem-menu-button",
    ];

    let triggerClicked = false;

    for (const selector of triggerSelectors) {
      const locator = page.locator(selector);

      const count = await locator.count();

      if (count === 0) {
        continue;
      }

      for (let index = count - 1; index >= 0; index--) {
        const candidate = locator.nth(index);

        try {
          if (!(await candidate.isVisible())) {
            continue;
          }

          console.log(`[Gemini] Upload trigger found: ${selector}`);

          await candidate.click({
            timeout: 5000,
            force: true,
          });

          triggerClicked = true;

          console.log("[Gemini] Upload & tools clicked.");

          break;
        } catch (error) {
          console.log(`[Gemini] Failed to click trigger ${selector}:`, error);
        }
      }

      if (triggerClicked) {
        break;
      }
    }

    if (!triggerClicked) {
      await this.dumpUploadDebugInfo(page);

      throw new Error("Could not find Gemini Upload & tools control.");
    }

    /*
     * Menu animation/rendering.
     */
    await page.waitForTimeout(800);

    /*
     * 3. Gemini may create the input immediately
     * after opening the menu.
     */
    const inputAfterOpening = page.locator('input[type="file"]');

    if ((await inputAfterOpening.count()) > 0) {
      console.log("[Gemini] File input appeared after opening tools menu.");

      await inputAfterOpening.last().setInputFiles(imagePath);

      await this.waitForUploadToSettle(
          page,
          baselineAttachmentCount,
          baselineVisibleImageCount,
          baselineSendUsable,
          label,
        );

      return;
    }

    /*
     * 4. Find "Upload files".
     *
     * Prefer Gemini's internal data-test-id because it
     * doesn't depend on Arabic / English.
     */
    const uploadSelectors = [
      '[data-test-id="uploader-images-files-button-advanced"]',
      'images-files-uploader[data-test-id="uploader-images-files-button-advanced"]',
      '[data-test-id="local-images-files-uploader-button"]',

      // Arabic
      '[role="menuitem"]:has-text("تحميل الملفات")',
      '[role="menuitem"]:has-text("تحميل ملفات")',
      'button:has-text("تحميل الملفات")',
      'button:has-text("تحميل ملفات")',

      // English
      '[role="menuitem"]:has-text("Upload files")',
      'button:has-text("Upload files")',
    ];

    let uploadControl = null;

    for (const selector of uploadSelectors) {
      const locator = page.locator(selector);

      const count = await locator.count();

      if (count === 0) {
        continue;
      }

      for (let index = count - 1; index >= 0; index--) {
        const candidate = locator.nth(index);

        try {
          if (!(await candidate.isVisible())) {
            continue;
          }

          uploadControl = candidate;

          console.log(`[Gemini] Upload files control found: ${selector}`);

          break;
        } catch {
          // Try another candidate.
        }
      }

      if (uploadControl) {
        break;
      }
    }

    /*
     * 5. Text fallback for localized versions.
     */
    if (!uploadControl) {
      const possibleItems = page.locator(
        '[role="menuitem"], mat-action-list button, mat-action-list div, .mat-mdc-menu-item',
      );

      const count = await possibleItems.count();

      console.log(`[Gemini] Menu item candidates: ${count}`);

      for (let index = 0; index < count; index++) {
        const item = possibleItems.nth(index);

        try {
          if (!(await item.isVisible())) {
            continue;
          }

          const text = ((await item.textContent()) ?? "").trim().toLowerCase();

          const aria = ((await item.getAttribute("aria-label")) ?? "").trim().toLowerCase();

          const combined = `${text} ${aria}`;

          console.log(`[Gemini] Menu candidate ${index}:`, combined);

          const looksLikeFileUpload =
            combined.includes("upload files") ||
            combined.includes("upload file") ||
            combined.includes("تحميل الملفات") ||
            combined.includes("تحميل ملفات") ||
            combined.includes("رفع الملفات") ||
            combined.includes("رفع ملفات");

          if (looksLikeFileUpload) {
            uploadControl = item;

            console.log(`[Gemini] Localized upload item matched: ${combined}`);

            break;
          }
        } catch {
          // Ignore candidate.
        }
      }
    }

    if (!uploadControl) {
      await this.dumpOpenMenuDebugInfo(page);

      throw new Error("Gemini Upload & tools opened, but the Upload files option could not be found.");
    }

    /*
     * 6. Prepare for native file chooser.
     */
    const fileChooserPromise = page
      .waitForEvent("filechooser", {
        timeout: 5000,
      })
      .catch(() => null);

    await uploadControl.click({
      timeout: 5000,
      force: true,
    });

    console.log("[Gemini] Upload files option clicked.");

    const fileChooser = await fileChooserPromise;

    if (fileChooser) {
      console.log("[Gemini] Native file chooser detected.");

      await fileChooser.setFiles(imagePath);

      await this.waitForUploadToSettle(
          page,
          baselineAttachmentCount,
          baselineVisibleImageCount,
          baselineSendUsable,
          label,
        );

      return;
    }

    /*
     * 7. Some Gemini builds don't dispatch
     * Playwright's filechooser event, but insert
     * input[type=file] after clicking the menu item.
     */
    await page.waitForTimeout(500);

    const dynamicInput = page.locator('input[type="file"]');

    if ((await dynamicInput.count()) > 0) {
      console.log("[Gemini] Dynamic file input found.");

      await dynamicInput.last().setInputFiles(imagePath);

      await this.waitForUploadToSettle(
          page,
          baselineAttachmentCount,
          baselineVisibleImageCount,
          baselineSendUsable,
          label,
        );

      return;
    }

    throw new Error("Gemini Upload files was clicked, but no file chooser or file input appeared.");
  }

  private async getComposerText(composer: Locator): Promise<string> {
    const tagName = await composer
      .evaluate((element) => element.tagName.toLowerCase())
      .catch(() => "");

    if (tagName === "textarea" || tagName === "input") {
      return composer.inputValue().catch(() => "");
    }

    return composer.innerText().catch(async () => (await composer.textContent().catch(() => "")) ?? "");
  }

  private async isGeminiGenerating(page: Page): Promise<boolean> {
    const generatingSelectors = [
      '[aria-busy="true"]',
      'button[aria-label*="Stop" i]',
      'gem-icon-button[arialabel*="Stop" i]',
      'gem-icon-button[aria-label*="Stop" i]',
      'gem-icon-button.submit mat-icon[data-mat-icon-name="stop_circle"]',
      'gem-icon-button.send-button mat-icon[data-mat-icon-name="stop_circle"]',
      'mat-icon[data-mat-icon-name="stop"]',
      'mat-icon[fonticon="stop"]',
      'mat-progress-bar',
      'section.processing-state_container--processing',
    ];

    for (const selector of generatingSelectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);

      for (let index = count - 1; index >= 0; index -= 1) {
        if (await locator.nth(index).isVisible().catch(() => false)) {
          return true;
        }
      }
    }

    return false;
  }

  private async waitForPromptSubmissionEvidence(
    page: Page,
    composer: Locator,
    baseline: {
      userCount: number;
      modelCount: number;
      url: string;
      networkSubmitted: () => boolean;
    },
    timeoutMs = 12_000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        return false;
      }

      if (baseline.networkSubmitted()) {
        console.log("[Gemini] Submission confirmed by Gemini network activity.");
        return true;
      }

      const composerText = (await this.getComposerText(composer))
        .replace(/\s+/g, " ")
        .trim();

      if (!composerText) {
        console.log("[Gemini] Submission confirmed because the composer cleared.");
        return true;
      }

      if (await this.isGeminiGenerating(page)) {
        console.log("[Gemini] Submission confirmed because Gemini started processing.");
        return true;
      }

      const [userCount, modelCount] = await Promise.all([
        page
          .locator(
            [
              "user-query",
              ".query-text",
              ".user-query",
              '[data-test-id*="user-query" i]',
              '[data-testid*="user-query" i]',
              '[data-message-author="user"]',
            ].join(","),
          )
          .count()
          .catch(() => 0),
        page
          .locator(
            [
              "model-response",
              "message-content",
              ".model-response-text",
              ".response-content",
              '[data-test-id*="model-response" i]',
              '[data-testid*="model-response" i]',
            ].join(","),
          )
          .count()
          .catch(() => 0),
      ]);

      if (userCount > baseline.userCount || modelCount > baseline.modelCount) {
        console.log("[Gemini] Submission confirmed by conversation DOM activity.");
        return true;
      }

      const currentUrl = page.url();

      if (
        currentUrl !== baseline.url &&
        /gemini\.google\.com\/app\//i.test(currentUrl)
      ) {
        console.log("[Gemini] Submission confirmed by conversation URL change.");
        return true;
      }

      await page.waitForTimeout(250);
    }

    return false;
  }

  private async findVisibleSendControl(page: Page): Promise<Locator | null> {
    /*
     * Keep this intentionally simple. Current working Gemini automations use
     * .send-button / button[aria-label="Send message"] rather than requiring
     * a particular aria-disabled/class state on the custom host.
     */
    const selectors = [
      "gem-icon-button.send-button",
      ".send-button",
      "button.send-button",
      'button[aria-label="Send message"]',
      'button[aria-label*="Send" i]',
      'gem-icon-button[arialabel="Send message"]',
      'gem-icon-button[aria-label="Send message"]',
      'gem-icon-button[arialabel="Send"]',
      'gem-icon-button[aria-label="Send"]',
      '[data-test-id="send-button"]',
      '[data-test-id="send-button-container"] .send-button',
      '[data-test-id="send-button-container"] gem-icon-button',
      'button[aria-label="إرسال الرسالة"]',
      'button[aria-label="إرسال"]',
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);

      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);

        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
    }

    return null;
  }

  private async submitPrompt(page: Page, prompt: string) {
    console.log("[Gemini] Preparing prompt...");

    await page.bringToFront().catch(() => undefined);

    const composer = await this.findComposer(page);

    if (!composer) {
      throw new Error("Could not find Gemini prompt composer.");
    }

    const finalPrompt = `
Edit the attached image according to the following instructions.

IMPORTANT:
Return the final result as an edited image.
Do not only explain the changes.
Do not return instructions or analysis.
Generate the edited image directly.

${prompt}
`.trim();

    /*
     * uploadImage() already waits for the selected file to reach a usable
     * Gemini state. Do NOT run the upload detector a second time here:
     * Gemini commonly consumes/resets its file input after a successful upload,
     * which made the old second check wait for 60 seconds and fail even though
     * the image was already attached.
     */
    console.log("[Gemini] Upload already settled. Preparing prompt submission.");

    const baseline = {
      userCount: await page
        .locator(
          [
            "user-query",
            ".query-text",
            ".user-query",
            '[data-test-id*="user-query" i]',
            '[data-testid*="user-query" i]',
            '[data-message-author="user"]',
          ].join(","),
        )
        .count()
        .catch(() => 0),
      modelCount: await page
        .locator(
          [
            "model-response",
            "message-content",
            ".model-response-text",
            ".response-content",
            '[data-test-id*="model-response" i]',
            '[data-testid*="model-response" i]',
          ].join(","),
        )
        .count()
        .catch(() => 0),
      url: page.url(),
    };

    let networkSubmitted = false;
    let submissionArmed = false;

    const onRequest = (request: import("playwright").Request) => {
      if (!submissionArmed || request.method() !== "POST") {
        return;
      }

      const url = request.url();

      if (
        /StreamGenerate|GenerateContent|BardFrontendService|batchexecute|conversation|generate/i.test(
          url,
        )
      ) {
        networkSubmitted = true;
      }
    };

    page.on("request", onRequest);

    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (page.isClosed()) {
          throw new Error("Gemini browser page closed before the prompt could be submitted.");
        }

        await page.bringToFront().catch(() => undefined);
        await composer.click({ force: true });

        /*
         * Playwright fill() is deliberately used here. It fires the browser's
         * input event for input/textarea/contenteditable. A current Gemini
         * Playwright implementation also dispatches input explicitly, which
         * makes Angular's composer state update reliably in production.
         */
        await composer.fill(finalPrompt);
        await composer.dispatchEvent("input").catch(() => undefined);

        const enteredText = (await this.getComposerText(composer))
          .replace(/\s+/g, " ")
          .trim();

        if (enteredText.length < Math.min(40, finalPrompt.length)) {
          throw new Error("Gemini prompt composer did not accept the prompt text.");
        }

        console.log(
          `[Gemini] Prompt entered (${enteredText.length} chars). Submission attempt ${attempt}/3.`,
        );

        submissionArmed = true;

        const sendControl = await this.findVisibleSendControl(page);
        let clickedSend = false;

        if (sendControl) {
          try {
            console.log("[Gemini] Clicking visible send control.");
            await sendControl.click({ timeout: 5_000 });
            clickedSend = true;
          } catch (error) {
            console.warn("[Gemini] Visible send control click failed; using Enter fallback:", error);
          }
        }

        if (!clickedSend) {
          console.log("[Gemini] Sending with Enter fallback.");
          await composer.click({ force: true }).catch(() => undefined);
          await page.keyboard.press("Enter");
        }

        const submitted = await this.waitForPromptSubmissionEvidence(
          page,
          composer,
          {
            ...baseline,
            networkSubmitted: () => networkSubmitted,
          },
          12_000,
        );

        if (submitted) {
          console.log("[Gemini] Prompt submission confirmed.");
          return;
        }

        /*
         * Some Gemini builds ignore a click while the attachment transitions.
         * If nothing actually started, wait briefly and retry the whole
         * fill+send sequence. Never close the page between these attempts.
         */
        console.warn(
          `[Gemini] Submission attempt ${attempt}/3 produced no activity. Retrying on the same page...`,
        );

        await page.waitForTimeout(1_500);
      }

      await this.dumpUploadDebugInfo(page).catch(() => undefined);

      throw new Error(
        "Gemini did not accept the prompt after 3 verified send attempts. The page stayed idle.",
      );
    } finally {
      page.off("request", onRequest);
    }
  }

  private getGenerationTimeoutMs() {
    const configured = Number.parseInt(
      process.env.GEMINI_GENERATION_TIMEOUT_MS ?? "",
      10,
    );

    if (!Number.isFinite(configured)) {
      return DEFAULT_GENERATION_TIMEOUT_MS;
    }

    return Math.min(Math.max(configured, 60_000), 10 * 60 * 1000);
  }

  private getDownloadButtons(page: Page): Locator {
    const roleButtons = page.getByRole("button", {
      name: /download full size|download|تنزيل بالحجم الكامل|تنزيل/i,
    });

    const customButtons = page.locator(
      [
        /* Gemini 2026 full-resolution image control. */
        "download-generated-image-button",
        "download-generated-image-button button",
        '[data-test-id*="download-generated-image" i]',
        'gem-icon-button[arialabel*="Download" i]',
        'gem-icon-button[aria-label*="Download" i]',
        'gem-icon-button[arialabel*="تنزيل"]',
        'gem-icon-button[aria-label*="تنزيل"]',
        '[data-test-id*="download" i]',
        '[aria-label*="Download full size" i]',
        '[aria-label*="تنزيل بالحجم الكامل"]',
      ].join(","),
    );

    return roleButtons.or(customButtons);
  }

  private async getImageSignatures(page: Page): Promise<Set<string>> {
    const signatures = await page
      .locator("img")
      .evaluateAll((images) =>
        images
          .map((element) => {
            const image = element as HTMLImageElement;
            const source = image.currentSrc || image.src || "";
            const srcset = image.srcset || "";

            return source ? `${source}|${srcset}` : "";
          })
          .filter(Boolean),
      )
      .catch(() => []);

    return new Set(signatures);
  }

  private async findNewGeneratedImage(
    page: Page,
    initialImageSignatures: Set<string>,
    allowLooseFallback: boolean,
  ): Promise<GeneratedImageCandidate | null> {
    const images = page.locator("img");

    const candidates = await images
      .evaluateAll((elements) =>
        elements.map((element, index) => {
          const image = element as HTMLImageElement;
          const rect = image.getBoundingClientRect();
          const source = image.currentSrc || image.src || "";
          const srcset = image.srcset || "";
          const signature = source ? `${source}|${srcset}` : "";

          let scopedToModelResponse = false;
          let looksLikeInputAttachment = false;
          let current: Element | null = image;

          for (let depth = 0; current && depth < 9; depth += 1) {
            const descriptor = [
              current.tagName,
              current.getAttribute("class") ?? "",
              current.getAttribute("data-test-id") ?? "",
              current.getAttribute("data-testid") ?? "",
              current.getAttribute("aria-label") ?? "",
            ]
              .join(" ")
              .toLowerCase();

            if (
              descriptor.includes("generated-image") ||
              descriptor.includes("image-generation") ||
              descriptor.includes("model-response") ||
              descriptor.includes("modelresponse") ||
              descriptor.includes("response-container")
            ) {
              scopedToModelResponse = true;
            }

            if (
              descriptor.includes("attachment") ||
              descriptor.includes("uploader") ||
              descriptor.includes("user-query") ||
              descriptor.includes("prompt-input") ||
              descriptor.includes("composer")
            ) {
              looksLikeInputAttachment = true;
            }

            current = current.parentElement;
          }

          return {
            index,
            signature,
            naturalWidth: image.naturalWidth || 0,
            naturalHeight: image.naturalHeight || 0,
            renderedWidth: rect.width,
            renderedHeight: rect.height,
            visible:
              image.complete &&
              rect.width > 0 &&
              rect.height > 0 &&
              window.getComputedStyle(image).visibility !== "hidden" &&
              window.getComputedStyle(image).display !== "none",
            scopedToModelResponse,
            looksLikeInputAttachment,
          };
        }),
      )
      .catch(() => []);

    const pickCandidate = async (scopedOnly: boolean) => {
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];

        if (
          !candidate.visible ||
          !candidate.signature ||
          initialImageSignatures.has(candidate.signature) ||
          candidate.looksLikeInputAttachment
        ) {
          continue;
        }

        if (candidate.naturalWidth < 320 || candidate.naturalHeight < 320) {
          continue;
        }

        if (scopedOnly && !candidate.scopedToModelResponse) {
          continue;
        }

        /*
         * The uploaded source image is rendered as a small composer/message
         * thumbnail. The real Gemini result is rendered as a large model
         * response. Never promote a tiny on-screen thumbnail to a completed
         * generated asset, even when its natural source is high resolution.
         */
        const renderedLongEdge = Math.max(
          candidate.renderedWidth,
          candidate.renderedHeight,
        );
        const renderedShortEdge = Math.min(
          candidate.renderedWidth,
          candidate.renderedHeight,
        );

        if (scopedOnly) {
          if (renderedLongEdge < 240 || renderedShortEdge < 140) {
            continue;
          }
        } else if (renderedLongEdge < 360 || renderedShortEdge < 180) {
          continue;
        }

        const locator = images.nth(candidate.index);

        if (!(await locator.isVisible().catch(() => false))) {
          continue;
        }

        return {
          image: locator,
          signature: candidate.signature,
          naturalWidth: candidate.naturalWidth,
          naturalHeight: candidate.naturalHeight,
          renderedWidth: candidate.renderedWidth,
          renderedHeight: candidate.renderedHeight,
          scopedToModelResponse: candidate.scopedToModelResponse,
        } satisfies GeneratedImageCandidate;
      }

      return null;
    };

    const scoped = await pickCandidate(true);

    if (scoped) {
      return scoped;
    }

    return allowLooseFallback ? pickCandidate(false) : null;
  }

  private async captureGeneratedImageSnapshot(
    page: Page,
    candidate: GeneratedImageCandidate,
  ): Promise<GeneratedImageSnapshot | null> {
    if (page.isClosed()) {
      return null;
    }

    const { image } = candidate;

    /*
     * Capture the actual image resource, not a screenshot of the rendered
     * <img>. A DOM screenshot records the CSS thumbnail size and was the
     * reason production could save a tiny image in the middle of a large
     * canvas while still marking the generation as DONE.
     */
    const captured = await image
      .evaluate(async (element) => {
        const img = element as HTMLImageElement;
        const source = img.currentSrc || img.src || "";
        const width = img.naturalWidth || 0;
        const height = img.naturalHeight || 0;

        if (!source || width < 320 || height < 320) {
          return { dataUrl: "", width, height };
        }

        if (source.startsWith("data:image/")) {
          return { dataUrl: source, width, height };
        }

        try {
          const response = await fetch(source, {
            credentials: "include",
            cache: "no-store",
          });

          if (response.ok) {
            const blob = await response.blob();
            const dataUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(typeof reader.result === "string" ? reader.result : "");
              reader.onerror = () => resolve("");
              reader.readAsDataURL(blob);
            });

            if (dataUrl) {
              return { dataUrl, width, height };
            }
          }
        } catch {
          // Try a full-natural-size canvas copy below.
        }

        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");

          if (!context) {
            return { dataUrl: "", width, height };
          }

          context.drawImage(img, 0, 0, width, height);
          return { dataUrl: canvas.toDataURL("image/png"), width, height };
        } catch {
          return { dataUrl: "", width, height };
        }
      })
      .catch(() => ({ dataUrl: "", width: 0, height: 0 }));

    if (!captured.dataUrl.startsWith("data:image/")) {
      return null;
    }

    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(
      captured.dataUrl,
    );

    if (!match) {
      return null;
    }

    if (captured.width < 320 || captured.height < 320) {
      console.warn(
        `[Gemini] Rejected low-resolution result capture: ${captured.width}x${captured.height}.`,
      );
      return null;
    }

    const mimeType = match[1];
    const extension = this.getExtensionFromMimeType(mimeType);

    console.log(
      `[Gemini] Captured full-resolution generated image bytes: ${captured.width}x${captured.height}.`,
    );

    return {
      buffer: Buffer.from(match[2], "base64"),
      mimeType,
      extension,
      width: captured.width,
      height: captured.height,
    };
  }

  private getImageDimensionsFromBuffer(
    buffer: Buffer,
    mimeType: string,
  ): { width: number; height: number } | null {
    const normalized = mimeType.toLowerCase().split(";")[0].trim();

    try {
      if (normalized === "image/png" && buffer.length >= 24) {
        return {
          width: buffer.readUInt32BE(16),
          height: buffer.readUInt32BE(20),
        };
      }

      if (normalized === "image/jpeg") {
        let offset = 2;

        while (offset + 9 < buffer.length) {
          if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
          }

          const marker = buffer[offset + 1];
          const isStartOfFrame =
            marker >= 0xc0 &&
            marker <= 0xcf &&
            ![0xc4, 0xc8, 0xcc].includes(marker);

          if (isStartOfFrame) {
            return {
              height: buffer.readUInt16BE(offset + 5),
              width: buffer.readUInt16BE(offset + 7),
            };
          }

          if (offset + 4 >= buffer.length) {
            break;
          }

          const segmentLength = buffer.readUInt16BE(offset + 2);

          if (segmentLength < 2) {
            break;
          }

          offset += 2 + segmentLength;
        }
      }

      if (
        normalized === "image/webp" &&
        buffer.length >= 30 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
      ) {
        const chunk = buffer.toString("ascii", 12, 16);

        if (chunk === "VP8X" && buffer.length >= 30) {
          const width =
            1 + buffer[24] + (buffer[25] << 8) + (buffer[26] << 16);
          const height =
            1 + buffer[27] + (buffer[28] << 8) + (buffer[29] << 16);

          return { width, height };
        }

        if (chunk === "VP8L" && buffer.length >= 25) {
          const b0 = buffer[21];
          const b1 = buffer[22];
          const b2 = buffer[23];
          const b3 = buffer[24];
          const width = 1 + (((b2 & 0x3f) << 8) | b1);
          const height = 1 + ((b3 << 6) | (b2 >> 6));

          return { width, height };
        }

        if (chunk === "VP8 " && buffer.length >= 30) {
          return {
            width: buffer.readUInt16LE(26) & 0x3fff,
            height: buffer.readUInt16LE(28) & 0x3fff,
          };
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private async startGeneratedImageNetworkCapture(
    page: Page,
    sourceImagePath: string,
  ): Promise<GeneratedImageNetworkCapture> {
    let armed = false;
    let best: NetworkImageCandidate | null = null;
    let sourceHash = "";

    try {
      const sourceBytes = await readFile(sourceImagePath);
      sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
    } catch {
      // Hash comparison is only an extra guard. Continue if the source file
      // cannot be read here because DOM/download detection still remains.
    }

    const onResponse = (response: PlaywrightResponse) => {
      if (!armed) {
        return;
      }

      void (async () => {
        try {
          const status = response.status();

          if (status < 200 || status >= 300) {
            return;
          }

          const headers = response.headers();
          const mimeType = (headers["content-type"] ?? "")
            .split(";")[0]
            .trim()
            .toLowerCase();

          if (!mimeType.startsWith("image/")) {
            return;
          }

          const url = response.url();

          /*
           * Ignore obvious site chrome/icons. Gemini's generated media is
           * normally served from Google media/storage hosts, while UI assets
           * are mostly gstatic and are much smaller.
           */
          if (
            /fonts\.gstatic\.com|www\.gstatic\.com|ssl\.gstatic\.com/i.test(
              url,
            )
          ) {
            return;
          }

          const buffer = await response.body();

          if (buffer.byteLength < 40_000) {
            return;
          }

          if (sourceHash) {
            const responseHash = createHash("sha256")
              .update(buffer)
              .digest("hex");

            if (responseHash === sourceHash) {
              console.log(
                "[Gemini] Ignored network image because it matches the uploaded source exactly.",
              );
              return;
            }
          }

          const dimensions = this.getImageDimensionsFromBuffer(
            buffer,
            mimeType,
          );

          /*
           * A generated image can be landscape, portrait or square. Reject
           * avatars/previews, but don't demand a particular 1024x1024 layout.
           */
          if (dimensions) {
            const longEdge = Math.max(dimensions.width, dimensions.height);
            const shortEdge = Math.min(dimensions.width, dimensions.height);

            if (longEdge < 640 || shortEdge < 320) {
              return;
            }
          } else if (buffer.byteLength < 120_000) {
            // If dimensions cannot be parsed, require a larger payload so
            // small UI images don't become completed generations.
            return;
          }

          const extension = this.getExtensionFromMimeType(mimeType);
          const candidate: NetworkImageCandidate = {
            buffer,
            mimeType,
            extension,
            width: dimensions?.width ?? 0,
            height: dimensions?.height ?? 0,
            byteLength: buffer.byteLength,
            url,
            capturedAt: Date.now(),
          };

          /*
           * Prefer the newest qualifying image. Gemini can first send a
           * preview and then replace it with the final media response.
           */
          best = candidate;

          console.log(
            `[Gemini] Captured network image candidate: ${candidate.width || "?"}x${candidate.height || "?"}, ${Math.round(
              candidate.byteLength / 1024,
            )} KB, ${candidate.url.slice(0, 180)}`,
          );
        } catch {
          // Response bodies can become unavailable during navigation. DOM and
          // download fallbacks continue to run, so this is intentionally soft.
        }
      })();
    };

    page.on("response", onResponse);

    return {
      arm: () => {
        armed = true;
        console.log("[Gemini] Network result capture armed.");
      },
      getBest: () => best,
      stop: () => {
        page.off("response", onResponse);
      },
    };
  }

  private async findLastVisibleDownloadButton(page: Page): Promise<Locator | null> {
    const buttons = this.getDownloadButtons(page);
    const count = await buttons.count().catch(() => 0);

    for (let index = count - 1; index >= 0; index--) {
      const button = buttons.nth(index);

      if (await button.isVisible().catch(() => false)) {
        return button;
      }
    }

    return null;
  }

  private async waitForGeneratedImage(
    page: Page,
    initialImageSignatures: Set<string>,
    initialDownloadCount: number,
    signal?: AbortSignal,
    networkCapture?: GeneratedImageNetworkCapture,
  ): Promise<GeneratedImageDetection> {
    const timeout = this.getGenerationTimeoutMs();
    const startedAt = Date.now();
    let generatedCandidate: GeneratedImageCandidate | null = null;
    let candidateDetectedAt: number | null = null;
    let candidateSignature = "";
    let lastProgressLogAt = 0;

    while (Date.now() - startedAt < timeout) {
      if (signal?.aborted) {
        throw new Error("Generation canceled.");
      }

      if (page.isClosed()) {
        throw new Error(
          signal?.aborted
            ? "Generation canceled."
            : "Gemini browser page closed before generation finished.",
        );
      }

      const networkCandidate = networkCapture?.getBest() ?? null;

      if (
        networkCandidate &&
        Date.now() - networkCandidate.capturedAt >= 4_000
      ) {
        console.log(
          `[Gemini] Using stable network image candidate after ${Math.round(
            (Date.now() - networkCandidate.capturedAt) / 1000,
          )}s.`,
        );

        return {
          downloadButton: null,
          image: null,
          snapshot: {
            buffer: networkCandidate.buffer,
            mimeType: networkCandidate.mimeType,
            extension: networkCandidate.extension,
            width: networkCandidate.width,
            height: networkCandidate.height,
          },
          detectedBy: "network-image",
        };
      }

      const downloadButtons = this.getDownloadButtons(page);
      const currentDownloadCount = await downloadButtons.count().catch(() => 0);

      if (currentDownloadCount > initialDownloadCount) {
        const downloadButton = await this.findLastVisibleDownloadButton(page);

        if (downloadButton) {
          const snapshot = generatedCandidate
            ? await this.captureGeneratedImageSnapshot(page, generatedCandidate)
            : null;

          return {
            downloadButton,
            image: generatedCandidate?.image ?? null,
            snapshot,
            detectedBy: "download-button",
          };
        }
      }

      const elapsed = Date.now() - startedAt;
      const detectedCandidate = await this.findNewGeneratedImage(
        page,
        initialImageSignatures,
        elapsed >= 20_000,
      );

      if (detectedCandidate) {
        generatedCandidate = detectedCandidate;

        if (candidateSignature !== detectedCandidate.signature) {
          candidateSignature = detectedCandidate.signature;
          candidateDetectedAt = Date.now();

          console.log(
            `[Gemini] Result candidate detected after ${Math.round(
              elapsed / 1000,
            )}s: natural=${detectedCandidate.naturalWidth}x${detectedCandidate.naturalHeight}, rendered=${Math.round(
              detectedCandidate.renderedWidth,
            )}x${Math.round(
              detectedCandidate.renderedHeight,
            )}, scoped=${detectedCandidate.scopedToModelResponse}.`,
          );
        }

        await detectedCandidate.image
          .hover({
            timeout: 1500,
          })
          .catch(() => undefined);

        await page.waitForTimeout(250);

        const downloadButton = await this.findLastVisibleDownloadButton(page);

        if (downloadButton) {
          const snapshot = await this.captureGeneratedImageSnapshot(
            page,
            detectedCandidate,
          );

          return {
            downloadButton,
            image: detectedCandidate.image,
            snapshot,
            detectedBy: "generated-image",
          };
        }

        const stableFor =
          candidateDetectedAt === null ? 0 : Date.now() - candidateDetectedAt;
        const requiredStableMs = detectedCandidate.scopedToModelResponse
          ? 5_000
          : GENERATED_IMAGE_DOWNLOAD_GRACE_MS;

        if (stableFor >= requiredStableMs) {
          const snapshot = await this.captureGeneratedImageSnapshot(
            page,
            detectedCandidate,
          );

          if (snapshot) {
            return {
              downloadButton: null,
              image: detectedCandidate.image,
              snapshot,
              detectedBy: "generated-image",
            };
          }
        }
      }

      const bodyText = await page
        .locator("body")
        .innerText()
        .catch(() => "");

      const normalized = bodyText.toLowerCase();

      if (
        normalized.includes("something went wrong") ||
        normalized.includes("حدث خطأ") ||
        normalized.includes("try again later") ||
        normalized.includes("حاول مرة أخرى لاحقًا")
      ) {
        throw new Error("Gemini returned an error while generating the image.");
      }

      const now = Date.now();

      if (now - lastProgressLogAt >= 10_000) {
        lastProgressLogAt = now;
        console.log(
          `[Gemini] Still waiting for full-resolution generated image... ${Math.round(
            (now - startedAt) / 1000,
          )}s elapsed.`,
        );
      }

      await page.waitForTimeout(1000);
    }

    const finalNetworkCandidate = networkCapture?.getBest() ?? null;

    if (finalNetworkCandidate) {
      console.log(
        "[Gemini] Generation wait reached its deadline; using the latest captured network image candidate.",
      );

      return {
        downloadButton: null,
        image: null,
        snapshot: {
          buffer: finalNetworkCandidate.buffer,
          mimeType: finalNetworkCandidate.mimeType,
          extension: finalNetworkCandidate.extension,
          width: finalNetworkCandidate.width,
          height: finalNetworkCandidate.height,
        },
        detectedBy: "network-image",
      };
    }

    if (generatedCandidate) {
      const snapshot = await this.captureGeneratedImageSnapshot(
        page,
        generatedCandidate,
      );

      if (snapshot) {
        return {
          downloadButton: null,
          image: generatedCandidate.image,
          snapshot,
          detectedBy: "generated-image",
        };
      }
    }

    throw new Error(
      `Nano Banana generation timed out after ${Math.round(
        timeout / 1000,
      )} seconds. No full-resolution generated image was detected.`,
    );
  }

  private getExtensionFromMimeType(mimeType: string) {
    const normalized = mimeType.toLowerCase().split(";")[0].trim();

    switch (normalized) {
      case "image/jpeg":
        return ".jpg";
      case "image/webp":
        return ".webp";
      case "image/png":
      default:
        return ".png";
    }
  }

  private async saveGeneratedImageFallback(
    page: Page,
    image: Locator | null,
    snapshot: GeneratedImageSnapshot | null,
    outputDirectory: string,
  ): Promise<ImageGenerationResult> {
    await mkdir(outputDirectory, {
      recursive: true,
    });

    let fullResolutionSnapshot = snapshot;

    if (image && !page.isClosed()) {
      const source = await image
        .evaluate((element) => {
          const img = element as HTMLImageElement;
          const currentSource = img.currentSrc || img.src || "";
          const srcset = img.srcset || "";
          const rect = img.getBoundingClientRect();

          return {
            signature: currentSource ? `${currentSource}|${srcset}` : "",
            naturalWidth: img.naturalWidth || 0,
            naturalHeight: img.naturalHeight || 0,
            renderedWidth: rect.width,
            renderedHeight: rect.height,
          };
        })
        .catch(() => null);

      if (source?.signature) {
        const fresh = await this.captureGeneratedImageSnapshot(page, {
          image,
          signature: source.signature,
          naturalWidth: source.naturalWidth,
          naturalHeight: source.naturalHeight,
          renderedWidth: source.renderedWidth,
          renderedHeight: source.renderedHeight,
          scopedToModelResponse: true,
        });

        if (fresh) {
          fullResolutionSnapshot = fresh;
        }
      }
    }

    if (fullResolutionSnapshot) {
      const fileName = `generated-${Date.now()}-${randomUUID()
        .slice(0, 8)}${fullResolutionSnapshot.extension}`;
      const absolutePath = join(outputDirectory, basename(fileName));

      await writeFile(absolutePath, fullResolutionSnapshot.buffer);

      console.log(
        `[Gemini] Result saved from full-resolution bytes (${fullResolutionSnapshot.width}x${fullResolutionSnapshot.height}):`,
        absolutePath,
      );

      return {
        absolutePath,
        fileName,
        mimeType: fullResolutionSnapshot.mimeType,
      };
    }

    if (!image || page.isClosed()) {
      throw new Error(
        "Gemini generated an image, but the browser page closed before the result could be saved.",
      );
    }

    const source = await image
      .evaluate((element) => {
        const img = element as HTMLImageElement;

        return img.currentSrc || img.src || "";
      })
      .catch(() => "");

    if (source.startsWith("http://") || source.startsWith("https://")) {
      try {
        const response = await page.context().request.get(source, {
          timeout: 30_000,
        });

        if (response.ok()) {
          const mimeType =
            response.headers()["content-type"]?.split(";")[0] || "image/png";
          const extension = this.getExtensionFromMimeType(mimeType);
          const fileName = `generated-${Date.now()}-${randomUUID()
            .slice(0, 8)}${extension}`;
          const absolutePath = join(outputDirectory, basename(fileName));

          await writeFile(absolutePath, await response.body());

          console.log(
            "[Gemini] Result saved directly from generated image URL:",
            absolutePath,
          );

          return {
            absolutePath,
            fileName,
            mimeType,
          };
        }
      } catch (error) {
        console.warn(
          "[Gemini] Could not download generated image URL directly. Falling back to screenshot:",
          error,
        );
      }
    }

    throw new Error(
      "Gemini generated a result, but a full-resolution image could not be captured. The app will not save a low-resolution DOM thumbnail as a completed version.",
    );
  }

  private getMimeType(extension: string) {
    switch (extension.toLowerCase()) {
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";

      case ".webp":
        return "image/webp";

      case ".png":
      default:
        return "image/png";
    }
  }

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    let page: Page | null = null;
    let abortHandler: (() => void) | null = null;
    let networkCapture: GeneratedImageNetworkCapture | null = null;

    /*
     * Every generation owns its own Gemini page.
     * The BrowserContext/profile is shared only for auth.
     */
    this.activeJobCount += 1;

    try {
      if (input.signal?.aborted) {
        throw new Error("Generation canceled.");
      }

      console.log(`[Gemini] Starting independent background generation. Active jobs: ${this.activeJobCount}`);

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

      /*
       * 1. Verify login on this job's own page.
       */
      await this.ensureLoggedIn(page);

      console.log("[Gemini] Session authenticated.");

      /*
       * 2. Make sure this page is on a fresh conversation.
       */
      await this.startFreshChat(page);

      await page.waitForTimeout(800);

      /*
       * The fresh-chat action may re-render the composer.
       * Verify that the job page is still authenticated.
       */
      await this.ensureLoggedIn(page);

      /*
       * 3. Upload the source image on THIS page only.
       */
      console.log("[Gemini] Uploading source image:", input.sourceImagePath);

      await this.uploadImage(page, input.sourceImagePath, "source image");

      console.log("[Gemini] Source image uploaded successfully.");

      const referenceImagePaths = input.referenceImagePaths ?? [];

      for (let index = 0; index < referenceImagePaths.length; index += 1) {
        const referenceImagePath = referenceImagePaths[index];

        if (!referenceImagePath) {
          continue;
        }

        console.log(
          `[Gemini] Uploading reference image ${index + 1}/${referenceImagePaths.length}:`,
          referenceImagePath,
        );

        await this.uploadImage(
          page,
          referenceImagePath,
          `reference image ${index + 1}/${referenceImagePaths.length}`,
        );

        console.log(
          `[Gemini] Reference image ${index + 1}/${referenceImagePaths.length} uploaded successfully.`,
        );
      }

      /*
       * Baseline before submitting the generation prompt.
       *
       * Track image URLs rather than only the count. Production Chromium can
       * reuse an existing <img> element when the generated result arrives.
       */
      const initialImageSignatures = await this.getImageSignatures(page);
      const initialDownloadCount = await this.getDownloadButtons(page)
        .count()
        .catch(() => 0);

      /*
       * Production Gemini can render the result in layouts where DOM image
       * selectors are unstable. Capture large image responses at the network
       * layer as an independent, full-resolution source of truth.
       */
      networkCapture = await this.startGeneratedImageNetworkCapture(
        page,
        input.sourceImagePath,
      );
      networkCapture.arm();

      /*
       * 4. Re-validate Gemini auth immediately before submission.
       *
       * If the page fell back to the signed-out shell after upload, fail fast
       * with a login error instead of waiting/retrying for minutes.
       */
      await this.ensureLoggedIn(page);

      /*
       * 5. Send prompt on this independent Gemini chat.
       */
      const effectivePrompt =
        referenceImagePaths.length > 0
          ? `IMAGE ROLES:
- The FIRST attached image is the SOURCE IMAGE to edit.
- The next ${referenceImagePaths.length} attached image${referenceImagePaths.length === 1 ? " is" : "s are"} VISUAL REFERENCE IMAGE${referenceImagePaths.length === 1 ? "" : "S"} only.
- Use the reference image${referenceImagePaths.length === 1 ? "" : "s"} only as guidance relevant to the requested edit.
- Treat the source image as the edit target. Do not replace it wholesale with a reference image unless the edit request explicitly asks for that.
- Do not copy unrelated content from the references.

EDIT REQUEST:
${input.prompt}`
          : input.prompt;

      await this.submitPrompt(page, effectivePrompt);

      /*
       * 6. Wait for this page's generated image.
       */
      console.log("[Gemini] Waiting for generated image...");

      const detection = await this.waitForGeneratedImage(
        page,
        initialImageSignatures,
        initialDownloadCount,
        input.signal,
        networkCapture,
      );

      console.log(
        `[Gemini] Generated image detected via ${detection.detectedBy}.`,
      );

      if (detection.downloadButton) {
        await mkdir(input.outputDirectory, {
          recursive: true,
        });

        try {
          const [download] = await Promise.all([
            page.waitForEvent("download", {
              timeout: 20_000,
            }),

            detection.downloadButton.click({
              force: true,
              timeout: 5000,
            }),
          ]);

          const suggestedName = download.suggestedFilename();
          const extension = extname(suggestedName) || ".png";
          const fileName = `generated-${Date.now()}-${randomUUID()
            .slice(0, 8)}${extension}`;
          const absolutePath = join(
            input.outputDirectory,
            basename(fileName),
          );

          await download.saveAs(absolutePath);

          console.log("[Gemini] Result downloaded:", absolutePath);

          return {
            absolutePath,
            fileName,
            mimeType: this.getMimeType(extension),
          };
        } catch (error) {
          console.warn(
            "[Gemini] Download control did not produce a file. Trying generated-image fallback:",
            error,
          );
        }
      }

      if (detection.image || detection.snapshot) {
        return this.saveGeneratedImageFallback(
          page,
          detection.image,
          detection.snapshot,
          input.outputDirectory,
        );
      }

      throw new Error(
        "Gemini finished, but the generated image could not be downloaded.",
      );
    } finally {
      networkCapture?.stop();

      if (input.signal && abortHandler) {
        input.signal.removeEventListener("abort", abortHandler);
      }

      /*
       * Critical for concurrency:
       * close ONLY this job's page.
       * Never close the shared BrowserContext here.
       */
      if (page && !page.isClosed()) {
        await page.close().catch(() => undefined);
      }

      this.activeJobCount = Math.max(0, this.activeJobCount - 1);

      console.log(`[Gemini] Independent generation finished. Active jobs: ${this.activeJobCount}`);
    }
  }

  async openManualLogin(): Promise<void> {
    /*
     * Reconnect uses the same Chrome profile.
     * Closing the automation context while generations
     * are running would kill every active Gemini tab.
     */
    if (this.activeJobCount > 0) {
      throw new Error(
        `Gemini is currently processing ${this.activeJobCount} generation${
          this.activeJobCount === 1 ? "" : "s"
        }. Wait for them to finish before reconnecting Gemini.`,
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
      GEMINI_URL,
    ]);

    console.log("[Gemini] Manual login browser opened.");
  }

  async checkConnection(): Promise<{
    connected: boolean;
    message: string;
  }> {
    /*
     * Always perform a real connection check.
     *
     * Do not report "connected" merely because a generation is active. That
     * masked the exact failure where an active Gemini tab was actually showing
     * the signed-out landing page.
     */
    let page: Page | null = null;

    try {
      console.log("[Gemini] Checking connection...");

      /*
       * Use exactly the same auth test that generation uses. This avoids
       * Settings saying Connected while generate() immediately reports
       * login required.
       */
      page = await this.createJobPage();

      await this.ensureLoggedIn(page);

      console.log("[Gemini] Connected: true");

      return {
        connected: true,
        message: "Gemini is connected.",
      };
    } catch (error) {
      const loginRequired = error instanceof GeminiLoginRequiredError;

      console.error("[Gemini] Connection check failed:", error);

      return {
        connected: false,
        message: loginRequired
          ? "Gemini sign in is required."
          : error instanceof Error
            ? error.message
            : "Could not check Gemini connection.",
      };
    } finally {
      /*
       * Close only the temporary status page. Never close the shared
       * BrowserContext because concurrent generation pages may be using it.
       */
      if (page && !page.isClosed()) {
        await page.close().catch(() => undefined);
      }
    }
  }

  private async closeAutomationContext() {
    /*
     * If a context launch is currently in progress, wait
     * until it resolves before attempting to release it.
     */
    if (this.contextPromise) {
      await this.contextPromise.catch(() => undefined);
    }

    const context = this.context;

    if (!context) {
      return;
    }

    /*
     * Clear the reference before close() so no new caller
     * receives a context that is already shutting down.
     */
    this.context = null;

    try {
      await context.close();
    } catch (error) {
      console.warn("[Gemini] Could not close browser context:", error);
    }
  }
}
