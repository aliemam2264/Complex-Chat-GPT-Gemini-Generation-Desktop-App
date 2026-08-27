import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

function getPlaywrightExecutablePath(): string | null {
  try {
    const executablePath = chromium.executablePath();

    return executablePath && existsSync(executablePath) ? executablePath : null;
  } catch {
    return null;
  }
}

function getWindowsBrowserCandidates(): string[] {
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

function getUnixBrowserCandidates(): string[] {
  if (process.platform === "win32") {
    return [];
  }

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
}

export function resolveBrowserExecutablePath(): string | null {
  const explicitPath = process.env.ESKANDER_BROWSER_EXECUTABLE?.trim();

  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath;
  }

  const playwrightPath = getPlaywrightExecutablePath();

  if (playwrightPath) {
    return playwrightPath;
  }

  const fallbackPath = [
    ...getWindowsBrowserCandidates(),
    ...getUnixBrowserCandidates(),
  ].find((candidate) => existsSync(candidate));

  return fallbackPath ?? null;
}

export function requireBrowserExecutablePath(): string {
  const executablePath = resolveBrowserExecutablePath();

  if (executablePath) {
    return executablePath;
  }

  throw new Error(
    "Browser runtime is not installed. Run `npm run browser:install` once, then try again.",
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

      // Keep an error listener after the spawn event as well. Without one,
      // a later ChildProcess error becomes an uncaught exception and can kill
      // the entire API process.
      child.removeListener("error", fail);
      child.on("error", (error) => {
        console.error("[BrowserRuntime] Detached browser process error:", error);
      });

      child.unref();
      resolve();
    });
  });
}
