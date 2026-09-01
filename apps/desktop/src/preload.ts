import { contextBridge, ipcRenderer } from "electron";

const apiArgument = process.argv.find((argument) =>
  argument.startsWith("--eskander-api-url="),
);

const apiUrl = apiArgument
  ? apiArgument.slice("--eskander-api-url=".length)
  : "http://127.0.0.1:4000";

contextBridge.exposeInMainWorld("eskanderStudio", {
  platform: process.platform,
  desktop: true,
  apiUrl,

  saveImage: (imageUrl: string, fileName: string) =>
    ipcRenderer.invoke("image:save", imageUrl, fileName),

  copyImage: (imageUrl: string) =>
    ipcRenderer.invoke("image:copy", imageUrl),

  prepareImageDrag: (imageUrl: string, fileName: string) =>
    ipcRenderer.invoke("image:prepare-drag", imageUrl, fileName),

  startImageDrag: (filePath: string, iconPath?: string | null) =>
    ipcRenderer.send("image:start-drag", filePath, iconPath),
});
