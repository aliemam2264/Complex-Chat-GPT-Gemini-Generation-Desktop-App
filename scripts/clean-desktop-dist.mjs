import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopDist = path.join(root, "apps", "desktop", "dist");

await rm(desktopDist, { recursive: true, force: true });
console.log(`Cleaned desktop build output: ${desktopDist}`);
