import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net } from "electron";

// Squirrel lifecycle events only exist in the installed Windows build.
// Do not load electron-squirrel-startup during local development.
if (process.platform === "win32" && app.isPackaged) {
  const squirrelStartup = require("electron-squirrel-startup") as boolean;

  if (squirrelStartup) {
    app.quit();
  }
}

type RuntimeServices = {
  apiProcess: ChildProcess | null;
  webProcess: ChildProcess | null;
  apiLog: WriteStream | null;
  webLog: WriteStream | null;
};

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let runtimeFailureShown = false;

const runtime: RuntimeServices = {
  apiProcess: null,
  webProcess: null,
  apiLog: null,
  webLog: null,
};

function getAppIconPath() {
  return join(app.getAppPath(), "assets", "icon.ico");
}

async function downloadImageBuffer(imageUrl: string) {
  const response = await net.fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Could not load image (${response.status}).`);
  }

  return Buffer.from(await response.arrayBuffer());
}

ipcMain.handle("image:save", async (_event, imageUrl: string, fileName: string) => {
  const result = await dialog.showSaveDialog({
    title: "Save Image",
    defaultPath: fileName || "eskander-render.png",
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "webp"],
      },
    ],
  });

  if (result.canceled || !result.filePath) {
    return {
      success: false,
      canceled: true,
    };
  }

  const buffer = await downloadImageBuffer(imageUrl);
  await writeFile(result.filePath, buffer);

  return {
    success: true,
    filePath: result.filePath,
  };
});

ipcMain.handle("image:copy", async (_event, imageUrl: string) => {
  const buffer = await downloadImageBuffer(imageUrl);
  const image = nativeImage.createFromBuffer(buffer);

  if (image.isEmpty()) {
    throw new Error("Could not decode image for clipboard.");
  }

  clipboard.writeImage(image);

  return {
    success: true,
  };
});

async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a local port."));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitForUrl(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
      });

      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  throw new Error(`Timed out waiting for ${url}${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
}

function pipeProcessLogs(child: ChildProcess, log: WriteStream, prefix: string) {
  child.stdout?.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    log.write(text);
    console.log(`[${prefix}] ${text.trimEnd()}`);
  });

  child.stderr?.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    log.write(text);
    console.error(`[${prefix}] ${text.trimEnd()}`);
  });
}

function spawnNodeRuntime(scriptPath: string, cwd: string, env: NodeJS.ProcessEnv, log: WriteStream, prefix: string) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  pipeProcessLogs(child, log, prefix);

  child.on("exit", (code, signal) => {
    log.write(`\n[exit] code=${String(code)} signal=${String(signal)}\n`);

    if (!isQuitting) {
      console.error(`${prefix} exited unexpectedly with code ${String(code)} and signal ${String(signal)}.`);

      if (!runtimeFailureShown) {
        runtimeFailureShown = true;

        dialog.showErrorBox(
          "Eskander Plus Studio service stopped",
          `${prefix} stopped unexpectedly. Restart Eskander Plus Studio.`,
        );

        app.quit();
      }
    }
  });

  return child;
}

async function terminateProcess(child: ChildProcess | null) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");

  await new Promise((resolve) => setTimeout(resolve, 1_500));

  if (child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });

      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
  } else {
    child.kill("SIGKILL");
  }
}

async function stopProductionServices() {
  await Promise.allSettled([terminateProcess(runtime.webProcess), terminateProcess(runtime.apiProcess)]);

  runtime.webLog?.end();
  runtime.apiLog?.end();

  runtime.webProcess = null;
  runtime.apiProcess = null;
  runtime.webLog = null;
  runtime.apiLog = null;
}

async function startProductionServices() {
  const userDataRoot = app.getPath("userData");
  const dataRoot = join(userDataRoot, "data");
  const storageRoot = join(userDataRoot, "storage");
  const logsRoot = join(userDataRoot, "logs");

  await Promise.all([
    mkdir(dataRoot, { recursive: true }),
    mkdir(storageRoot, { recursive: true }),
    mkdir(logsRoot, { recursive: true }),
  ]);

  const apiPort = await getFreePort();
  let webPort = await getFreePort();

  while (webPort === apiPort) {
    webPort = await getFreePort();
  }

  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;

  const apiEntry = join(app.getAppPath(), "apps", "api", "dist", "server.mjs");
  const webRuntimeRoot = join(process.resourcesPath, "web-runtime");
  const webEntry = join(webRuntimeRoot, "eskander-server.cjs");
  const playwrightBrowsers = join(process.resourcesPath, "playwright-browsers");
  const databasePath = join(dataRoot, "eskander.sqlite").replaceAll("\\", "/");

  runtime.apiLog = createWriteStream(join(logsRoot, "api.log"), {
    flags: "a",
  });
  runtime.webLog = createWriteStream(join(logsRoot, "web.log"), {
    flags: "a",
  });

  runtime.apiProcess = spawnNodeRuntime(
    apiEntry,
    app.getAppPath(),
    {
      NODE_ENV: "production",
      API_HOST: "127.0.0.1",
      API_PORT: String(apiPort),
      WEB_URL: webUrl,
      STORAGE_PATH: storageRoot,
      DATABASE_URL: `file:${databasePath}`,
      PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsers,
    },
    runtime.apiLog,
    "API",
  );

  await waitForUrl(`${apiUrl}/health`);

  runtime.webProcess = spawnNodeRuntime(
    webEntry,
    webRuntimeRoot,
    {
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: String(webPort),
    },
    runtime.webLog,
    "WEB",
  );

  await waitForUrl(webUrl);

  return {
    apiUrl,
    webUrl,
  };
}

function createMainWindow(webUrl: string, apiUrl: string) {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: "#0A0A0A",
    title: "Eskander Plus Studio",
    icon: getAppIconPath(),
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--eskander-api-url=${apiUrl}`],
    },
  });

  void mainWindow.loadURL(webUrl);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      if (app.isPackaged) {
        const services = await startProductionServices();
        createMainWindow(services.webUrl, services.apiUrl);
      } else {
        createMainWindow(
          process.env.ESKANDER_WEB_URL ?? "http://127.0.0.1:3000",
          process.env.ESKANDER_API_URL ?? "http://127.0.0.1:4000",
        );
      }
    } catch (error) {
      console.error("Failed to start Eskander Plus Studio:", error);

      dialog.showErrorBox(
        "Eskander Plus Studio could not start",
        error instanceof Error ? error.message : "Unknown startup error.",
      );

      await stopProductionServices();
      app.quit();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
        // On Windows the window normally stays open for the lifetime of the app.
        // This fallback intentionally avoids starting duplicate API/web services.
      }
    });
  });
}

app.on("before-quit", (event) => {
  if (!app.isPackaged || isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;

  void stopProductionServices().finally(() => {
    app.exit(0);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
