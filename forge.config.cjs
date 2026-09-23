const path = require("node:path");

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "EPlusAISuit",
    appCopyright: "Copyright (c) e + AI Suit",
    win32metadata: {
      CompanyName: "e + AI Suit",
      FileDescription: "e + AI Suit desktop application",
      InternalName: "EPlusAISuit",
      OriginalFilename: "EPlusAISuit.exe",
      ProductName: "e + AI Suit",
    },
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
        name: "EPlusAISuit",
        authors: "e + AI Suit",
        description: "Local-first AI image editing studio.",
        setupExe: "EPlusAISuit-Setup.exe",
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
