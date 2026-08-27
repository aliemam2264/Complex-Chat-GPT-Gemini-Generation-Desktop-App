# Eskander Plus Studio — Windows Packaging

This patch converts the app into a local-first Windows desktop application packaged with Electron Forge and Squirrel.Windows.

## Runtime architecture

The installed application starts everything by itself:

- Electron desktop shell
- Express API on a random `127.0.0.1` port
- Next.js standalone server on another random `127.0.0.1` port
- SQLite database stored under the current Windows user's AppData
- Project images, generated versions, provider profiles, settings and logs under AppData
- Bundled Playwright Chromium used by ChatGPT/Gemini automation

The end user does **not** need Node.js, npm, PostgreSQL or Google Chrome installed.

Internet is still required for ChatGPT and Gemini themselves.

## Important database change

The desktop build uses SQLite instead of PostgreSQL. This is intentional so the installer can run on a normal Windows machine without installing a database server.

Development also moves to SQLite through the root scripts. Existing PostgreSQL records are not automatically copied into the new SQLite database. Existing image files are not deleted.

## First setup on the build machine

Run from the repository root:

```powershell
npm install
npm run db:generate
```

You can then test development normally:

```powershell
npm run dev
```

The development SQLite database is stored at:

```text
storage/eskander-dev.sqlite
```

## Build the installer

Run on Windows x64 from the repository root:

```powershell
npm run make:win
```

The script will automatically:

1. install the matching Playwright Chromium runtime locally
2. generate the Prisma SQLite client
3. bundle the Express API
4. create a Next.js standalone production runtime
5. compile Electron main/preload
6. validate required runtime files
7. package with Electron Forge
8. create the Squirrel.Windows installer

Expected installer output:

```text
out\make\squirrel.windows\x64\EskanderPlusStudio-Setup.exe
```

Forge also creates Squirrel release files beside the installer. Keep them if auto-update support is added later.

## Installed data locations

Electron uses `app.getPath("userData")`. On Windows this is normally under:

```text
%APPDATA%\Eskander Plus Studio\
```

Inside it:

```text
data\eskander.sqlite
storage\projects\...
storage\browser-profiles\chatgpt\...
storage\browser-profiles\gemini\...
storage\settings\generation-runtime.json
logs\api.log
logs\web.log
```

Application upgrades do not overwrite these user files.

## Network behavior

The API and Next.js server bind to `127.0.0.1` only and use free local ports selected at startup. They are not exposed to the LAN and do not depend on the user's Wi-Fi subnet, router address or office network configuration.

The renderer receives the actual API URL from Electron preload at runtime, so there is no production dependency on a hardcoded `localhost:4000` port.

## Browser automation

The production package uses the Chromium binary bundled during `npm run make:win`. ChatGPT and Gemini each keep a persistent browser profile under AppData.

The first time a provider is used, open Settings and connect/sign in. The login persists between application launches.

## Build-machine requirements

End users do not need these, but the Windows machine that creates the installer should have:

- Node.js/npm
- internet access while installing npm packages and Playwright Chromium
- Windows build tooling if Electron needs to rebuild the native SQLite module

## Code signing

The installer works unsigned, but Windows SmartScreen may warn users. Before public distribution, use a Windows code-signing certificate and add signing configuration to `forge.config.cjs`.
