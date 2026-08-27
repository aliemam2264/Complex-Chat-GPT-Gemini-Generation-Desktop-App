import { cp, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagingRoot = path.join(root, "packaging");
const webTarget = path.join(packagingRoot, "web-runtime");
const browsersTarget = path.join(packagingRoot, "playwright-browsers");

async function findFile(directory, fileName, depth = 5) {
  if (depth < 0 || !existsSync(directory)) return null;

  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name === fileName) {
      return path.join(directory, entry.name);
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const result = await findFile(path.join(directory, entry.name), fileName, depth - 1);
    if (result) return result;
  }

  return null;
}

async function prepareWebRuntime() {
  const standaloneRoot = path.join(root, "apps", "web", ".next", "standalone");
  const serverPath = await findFile(standaloneRoot, "server.js", 6);

  if (!serverPath) {
    throw new Error("Next.js standalone server.js was not found. Make sure next.config.ts uses output: 'standalone' and run npm run build:web.");
  }

  const relativeServerPath = path.relative(standaloneRoot, serverPath);
  const relativeAppRoot = path.dirname(relativeServerPath);
  const targetAppRoot = path.join(webTarget, relativeAppRoot);

  await rm(webTarget, { recursive: true, force: true });
  await mkdir(webTarget, { recursive: true });
  await cp(standaloneRoot, webTarget, { recursive: true });

  const publicSource = path.join(root, "apps", "web", "public");
  const staticSource = path.join(root, "apps", "web", ".next", "static");

  if (existsSync(publicSource)) {
    await cp(publicSource, path.join(targetAppRoot, "public"), { recursive: true });
  }

  if (existsSync(staticSource)) {
    await mkdir(path.join(targetAppRoot, ".next"), { recursive: true });
    await cp(staticSource, path.join(targetAppRoot, ".next", "static"), { recursive: true });
  }

  const launcherPath = path.join(webTarget, "eskander-server.cjs");
  const requirePath = `./${relativeServerPath.replaceAll("\\", "/")}`;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(launcherPath, `require(${JSON.stringify(requirePath)});\n`, "utf8");

  const serverStats = await stat(launcherPath);
  if (!serverStats.isFile()) {
    throw new Error("Prepared Next.js runtime is missing its launcher.");
  }
}

async function preparePlaywrightRuntime() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";

  const { chromium } = await import("playwright");
  const executablePath = chromium.executablePath();
  const normalized = path.normalize(executablePath);
  const marker = `${path.sep}.local-browsers${path.sep}`;
  const markerIndex = normalized.indexOf(marker);

  if (markerIndex === -1 || !existsSync(executablePath)) {
    throw new Error("Hermetic Playwright Chromium was not found. Run npm run browser:install first.");
  }

  const localBrowsersRoot = normalized.slice(0, markerIndex + marker.length - 1);

  await rm(browsersTarget, { recursive: true, force: true });
  await mkdir(browsersTarget, { recursive: true });
  await cp(localBrowsersRoot, browsersTarget, { recursive: true });
}

await rm(packagingRoot, { recursive: true, force: true });
await mkdir(packagingRoot, { recursive: true });
await prepareWebRuntime();
await preparePlaywrightRuntime();

console.log("Production runtime prepared:");
console.log(`- Web: ${webTarget}`);
console.log(`- Chromium: ${browsersTarget}`);
