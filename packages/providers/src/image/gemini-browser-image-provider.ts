import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { basename, extname, join } from "node:path";

import { chromium, type BrowserContext, type Locator, type Page } from "playwright";

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
     * Gemini hydrates after DOMContentLoaded. A one-shot composer check
     * can report a false "login required" even when the Chrome profile
     * is already authenticated. Give the page enough time to hydrate and
     * use the persisted Google session as the primary auth signal.
     */
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);

    const deadline = Date.now() + 20_000;

    while (Date.now() < deadline) {
      const composer = await this.findComposer(page);

      const [hasGoogleSession, hasAccountControl] = await Promise.all([
        this.hasGoogleSession(page),
        this.hasVisibleAccountControl(page),
      ]);

      if (composer && (hasGoogleSession || hasAccountControl)) {
        return composer;
      }

      if (!hasAccountControl && (await this.hasVisibleSignInControl(page))) {
        throw new GeminiLoginRequiredError();
      }

      await page.waitForTimeout(500);
    }

    const [hasGoogleSession, hasAccountControl] = await Promise.all([
      this.hasGoogleSession(page),
      this.hasVisibleAccountControl(page),
    ]);

    if (!hasGoogleSession && !hasAccountControl) {
      throw new GeminiLoginRequiredError();
    }

    throw new Error(
      `Gemini is signed in, but the prompt composer could not be found. Current URL: ${page.url()}`,
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

  private async waitForUploadToSettle(page: Page) {
    console.log("[Gemini] Waiting for attachment upload...");

    /*
     * New Gemini UI uses this class while attachment
     * is uploading.
     */
    const loadingAttachment = page.locator(".gem-attachment-content.loading");

    try {
      if ((await loadingAttachment.count()) > 0) {
        await loadingAttachment
          .first()
          .waitFor({
            state: "detached",
            timeout: 30_000,
          })
          .catch(() => undefined);
      }
    } catch {
      // Fall through.
    }

    /*
     * Current UI also exposes uploading state through
     * send-button-container.
     */
    try {
      await page.waitForFunction(
        () => {
          const container = document.querySelector('[data-test-id="send-button-container"]');

          if (!container) {
            return true;
          }

          return container.getAttribute("aria-disabled") !== "true";
        },
        undefined,
        {
          timeout: 30_000,
        },
      );
    } catch {
      // Some layouts don't expose this state.
    }

    await page.waitForTimeout(800);

    console.log("[Gemini] Attachment upload finished.");
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

  private async uploadImage(page: Page, imagePath: string) {
    console.log("[Gemini] Starting image upload...");

    await page.waitForTimeout(1000);

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

        await this.waitForUploadToSettle(page);

        return;
      }

      await page.waitForTimeout(300);

      const input = page.locator('input[type="file"]');

      if ((await input.count()) > 0) {
        await input.last().setInputFiles(imagePath);

        await this.waitForUploadToSettle(page);

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

      await this.waitForUploadToSettle(page);

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

      await this.waitForUploadToSettle(page);

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

      await this.waitForUploadToSettle(page);

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

      await this.waitForUploadToSettle(page);

      return;
    }

    throw new Error("Gemini Upload files was clicked, but no file chooser or file input appeared.");
  }

  private async submitPrompt(page: Page, prompt: string) {
    console.log("[Gemini] Preparing prompt...");

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
     * Make sure attachment has finished
     * before writing the prompt.
     */
    await page.waitForTimeout(800);

    await composer.click({
      force: true,
    });

    const tagName = await composer.evaluate((element) => element.tagName.toLowerCase());

    const contentEditable = await composer.getAttribute("contenteditable");

    if (tagName === "textarea" || tagName === "input") {
      await composer.fill(finalPrompt);
    } else if (contentEditable === "true") {
      /*
       * contenteditable used by current Gemini.
       */
      await page.keyboard.press("Control+A");

      await page.keyboard.insertText(finalPrompt);
    } else {
      throw new Error("Gemini composer type is not supported.");
    }

    console.log("[Gemini] Prompt entered.");

    await page.waitForTimeout(500);

    /*
     * Gemini send controls.
     */
    const sendSelectors = [
      '[data-test-id="send-button"]',

      'button[aria-label="Send message"]',

      'button[aria-label="إرسال الرسالة"]',

      'button[aria-label="إرسال"]',

      'button[type="submit"]',
    ];

    for (const selector of sendSelectors) {
      const send = page.locator(selector);

      const count = await send.count();

      if (count === 0) {
        continue;
      }

      const candidate = send.last();

      try {
        if (!(await candidate.isVisible())) {
          continue;
        }

        const disabled = await candidate.isDisabled().catch(() => false);

        if (disabled) {
          continue;
        }

        console.log(`[Gemini] Sending using ${selector}`);

        await candidate.click({
          force: true,
          timeout: 5000,
        });

        console.log("[Gemini] Prompt sent successfully.");

        return;
      } catch {
        // Try next selector.
      }
    }

    /*
     * Keyboard fallback.
     */
    console.log("[Gemini] Send button not found. Using Enter.");

    await composer.press("Enter");

    console.log("[Gemini] Prompt sent successfully.");
  }

  private async waitForGeneratedImage(page: Page, initialImageCount: number, initialDownloadCount: number) {
    const timeout = 5 * 60 * 1000;

    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      /*
       * Detect if Gemini generated new visual content.
       */
      const currentImageCount = await page.locator("img").count();

      /*
       * Download button can be Arabic or English.
       */
      const downloadButtons = page.getByRole("button", {
        name: /download full size|download|تنزيل بالحجم الكامل|تنزيل/i,
      });

      const currentDownloadCount = await downloadButtons.count();

      if (currentDownloadCount > initialDownloadCount && currentDownloadCount > 0) {
        const button = downloadButtons.last();

        try {
          if (await button.isVisible()) {
            return button;
          }
        } catch {
          // Keep waiting.
        }
      }

      /*
       * Some Gemini layouts only show download
       * controls when hovering over the image.
       */
      if (currentImageCount > initialImageCount) {
        const images = page.locator("img");

        try {
          await images.last().hover({
            timeout: 1500,
          });
        } catch {
          // Ignore.
        }

        await page.waitForTimeout(300);

        const buttonsAfterHover = await downloadButtons.count();

        if (buttonsAfterHover > 0) {
          const button = downloadButtons.last();

          try {
            if (await button.isVisible()) {
              return button;
            }
          } catch {
            // Continue.
          }
        }
      }

      /*
       * Detect Gemini errors.
       */
      const bodyText = await page
        .locator("body")
        .innerText()
        .catch(() => "");

      const normalized = bodyText.toLowerCase();

      if (normalized.includes("something went wrong") || normalized.includes("حدث خطأ")) {
        throw new Error("Gemini returned an error while generating the image.");
      }

      await page.waitForTimeout(2000);
    }

    throw new Error("Nano Banana generation timed out. No generated image was detected.");
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

      await this.uploadImage(page, input.sourceImagePath);

      console.log("[Gemini] Source image uploaded successfully.");

      /*
       * Baseline before submitting the generation prompt.
       */
      const initialImageCount = await page.locator("img").count();

      const initialDownloadCount = await page
        .getByRole("button", {
          name: /download full size|download|تنزيل بالحجم الكامل|تنزيل/i,
        })
        .count();

      /*
       * 4. Send prompt on this independent Gemini chat.
       */
      await this.submitPrompt(page, input.prompt);

      /*
       * 5. Wait for this page's generated image.
       */
      console.log("[Gemini] Waiting for generated image...");

      const downloadButton = await this.waitForGeneratedImage(page, initialImageCount, initialDownloadCount);

      console.log("[Gemini] Generated image detected.");

      /*
       * 6. Download result.
       */
      await mkdir(input.outputDirectory, {
        recursive: true,
      });

      const [download] = await Promise.all([
        page.waitForEvent("download", {
          timeout: 30_000,
        }),

        downloadButton.click({
          force: true,
        }),
      ]);

      const suggestedName = download.suggestedFilename();

      const extension = extname(suggestedName) || ".png";

      /*
       * randomUUID avoids filename collisions when multiple
       * generations finish in the same millisecond/session.
       */
      const fileName = `generated-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;

      const absolutePath = join(input.outputDirectory, basename(fileName));

      await download.saveAs(absolutePath);

      console.log("[Gemini] Result downloaded:", absolutePath);

      return {
        absolutePath,
        fileName,
        mimeType: this.getMimeType(extension),
      };
    } finally {
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
