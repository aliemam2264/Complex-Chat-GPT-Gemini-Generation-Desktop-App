import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const desktopDist = resolve(process.cwd(), "apps", "desktop", "dist");
await rm(desktopDist, { recursive: true, force: true });
console.log(`[build] Cleaned ${desktopDist}`);
