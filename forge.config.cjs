const path = require("node:path");

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "EskanderPlusStudio",
    icon: path.resolve(__dirname, "assets", "icon.ico"),
    extraResource: [
      path.resolve(__dirname, "packaging", "web-runtime"),
      path.resolve(__dirname, "packaging", "playwright-browsers"),
    ],
    ignore: [
      /^\/\.git($|\/)/,
      /^\/\.github($|\/)/,
      /^\/\.vscode($|\/)/,
      /^\/out($|\/)/,
      /^\/storage($|\/)/,
      /^\/packaging($|\/)/,
      /^\/apps\/web\/\.next($|\/)/,
      /^\/apps\/web\/node_modules($|\/)/,
      /\.log$/,
      /\.zip$/,
    ],
  },

  rebuildConfig: {
    force: true,
  },

  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "EskanderPlusStudio",
        authors: "Eskander Plus Studio",
        description: "Local-first AI image editing studio.",
        setupExe: "EskanderPlusStudio-Setup.exe",
        setupIcon: path.resolve(__dirname, "assets", "icon.ico"),
        noMsi: true,
      },
    },
  ],

  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
  ],
};
