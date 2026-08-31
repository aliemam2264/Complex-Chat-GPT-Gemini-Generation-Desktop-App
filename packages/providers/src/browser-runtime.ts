import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

type BrowserRuntimeSource =
  | "explicit"
  | "system-chrome"
  | "system-edge"
  | "playwright";

type BrowserRuntime = {
  executablePath: string;
  source: BrowserRuntimeSource;
};

function getPlaywrightExecutablePath(): string | null {
  try {
    const executablePath = chromium.executablePath();

    return executablePath && existsSync(executablePath) ? executablePath : null;
  } catch {
    return null;
  }
}

function getWindowsChromeCandidates(): string[] {
  if (process.platform !== "win32") {
    return [];
  }

  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.PROGRAMFILES;
  const programFilesX86 = process.env["PROGRAMFILES(X86)"];

  return [
    localAppData
      ? join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
      : "",
    programFiles
      ? join(programFiles, "Google", "Chrome", "Application", "chrome.exe")
      : "",
    programFilesX86
      ? join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe")
      : "",
  ].filter(Boolean);
}

function getWindowsEdgeCandidates(): string[] {
  if (process.platform !== "win32") {
    return [];
  }

  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.PROGRAMFILES;
  const programFilesX86 = process.env["PROGRAMFILES(X86)"];

  return [
    localAppData
      ? join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")
      : "",
    programFiles
      ? join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe")
      : "",
    programFilesX86
      ? join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
      : "",
  ].filter(Boolean);
}

function getUnixChromeCandidates(): string[] {
  if (process.platform === "win32") {
    return [];
  }

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
}

function getUnixEdgeCandidates(): string[] {
  if (process.platform === "win32") {
    return [];
  }

  return [
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
}

function firstExisting(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * IMPORTANT:
 *
 * Prefer a normal installed browser over Playwright's Chrome-for-Testing.
 *
 * ChatGPT and Gemini both work in development with a normal Chrome profile,
 * while Chrome-for-Testing can successfully load/authenticate the websites but
 * still fail to receive model responses in packaged builds.
 *
 * Windows normally ships with Edge, so a clean Windows install still has a
 * supported system-browser fallback without requiring the user to install
 * Google Chrome separately.
 */
export function resolveBrowserRuntime(): BrowserRuntime | null {
  const explicitPath = process.env.ESKANDER_BROWSER_EXECUTABLE?.trim();

  if (explicitPath && existsSync(explicitPath)) {
    return {
      executablePath: explicitPath,
      source: "explicit",
    };
  }

  const systemChrome = firstExisting([
    ...getWindowsChromeCandidates(),
    ...getUnixChromeCandidates(),
  ]);

  if (systemChrome) {
    return {
      executablePath: systemChrome,
      source: "system-chrome",
    };
  }

  const systemEdge = firstExisting([
    ...getWindowsEdgeCandidates(),
    ...getUnixEdgeCandidates(),
  ]);

  if (systemEdge) {
    return {
      executablePath: systemEdge,
      source: "system-edge",
    };
  }

  const playwrightPath = getPlaywrightExecutablePath();

  if (playwrightPath) {
    console.warn(
      "[BrowserRuntime] No system Chrome/Edge found. Falling back to bundled Playwright browser.",
    );

    return {
      executablePath: playwrightPath,
      source: "playwright",
    };
  }

  return null;
}

export function resolveBrowserExecutablePath(): string | null {
  return resolveBrowserRuntime()?.executablePath ?? null;
}

export function requireBrowserExecutablePath(): string {
  const runtime = resolveBrowserRuntime();

  if (runtime) {
    console.log(
      `[BrowserRuntime] Using ${runtime.source}: ${runtime.executablePath}`,
    );

    return runtime.executablePath;
  }

  throw new Error(
    "No supported browser runtime was found. Install Google Chrome or Microsoft Edge, or run `npm run browser:install`.",
  );
}

export async function openDetachedBrowser(
  executablePath: string,
  args: string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executablePath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });

    let settled = false;

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(
        new Error(
          `Could not open the sign-in browser (${executablePath}): ${error.message}`,
        ),
      );
    };

    child.once("error", fail);

    child.once("spawn", () => {
      if (settled) {
        return;
      }

      settled = true;

      child.removeListener("error", fail);
      child.on("error", (error) => {
        console.error("[BrowserRuntime] Detached browser process error:", error);
      });

      child.unref();
      resolve();
    });
  });
}
