import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules", "playwright", "cli.js");

if (!existsSync(cli)) {
  console.error("Playwright is not installed. Run npm install first.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [cli, "install", "chromium"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: "0",
  },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
