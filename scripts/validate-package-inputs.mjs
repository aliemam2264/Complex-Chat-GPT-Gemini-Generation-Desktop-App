import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredPaths = [
  "assets/icon.ico",
  "apps/api/dist/server.mjs",
  "apps/desktop/dist/main.js",
  "apps/desktop/dist/preload.js",
  "packaging/web-runtime/eskander-server.cjs",
  "packaging/playwright-browsers",
];

const missing = requiredPaths.filter((relativePath) =>
  !existsSync(path.join(root, relativePath)),
);

if (missing.length > 0) {
  console.error("Packaging validation failed. Missing:");
  for (const item of missing) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log("Packaging runtime validation passed.");
