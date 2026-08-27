import { resolve } from "node:path";

export function getStorageRoot() {
  if (process.env.STORAGE_PATH) {
    return resolve(process.env.STORAGE_PATH);
  }

  return resolve(process.cwd(), "../../storage");
}
