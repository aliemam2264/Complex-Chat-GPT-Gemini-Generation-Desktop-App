import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import { chromium, type Browser, type BrowserContext, type CDPSession, type Locator, type Page, type Response } from "playwright";

import { requireBrowserExecutablePath } from "../browser-runtime";

import type { PromptGenerationInput, PromptProvider } from "./types";
import type { ImageGenerationInput, ImageGenerationResult } from "../image/types";

const CHATGPT_URL = "https://chatgpt.com/";
const CHATGPT_SESSION_URL = "https://chatgpt.com/api/auth/session";

type ChatGPTBrowserPromptProviderOptions = {
  userDataDirectory: string;
};

type ConnectionStatus = {
  connected: boolean;
  message: string;
};

export class ChatGPTLoginRequiredError extends Error {
  constructor() {
    super("ChatGPT sign in is required. Connect ChatGPT from Settings, then try again.");

    this.name = "ChatGPTLoginRequiredError";
  }
}

class ChatGPTUnexpectedVisualOutputError extends Error {
  constructor() {
    super("ChatGPT returned a visual result instead of the requested text prompt.");
    this.name = "ChatGPTUnexpectedVisualOutputError";
  }
}

export class ChatGPTBrowserPromptProvider implements PromptProvider {
  private context: BrowserContext | null = null;

  private contextPromise: Promise<BrowserContext> | null = null;

  private browser: Browser | null = null;

  private browserProcess: ChildProcess | null = null;

  private browserProcessPid: number | null = null;

  private manualLoginContext: BrowserContext | null = null;

  private manualLoginVisible = false;

  private activeJobCount = 0;

  private windowsHideGuard: ChildProcess | null = null;

  private readonly userDataDirectory: string;

  private readonly authCookieSnapshotPath: string;

  private rememberedAuthCookies: Parameters<BrowserContext["addCookies"]>[0] | null = null;

  constructor(options: ChatGPTBrowserPromptProviderOptions) {
    this.userDataDirectory = options.userDataDirectory;
    this.authCookieSnapshotPath = join(this.userDataDirectory, "eskander-chatgpt-auth-cookies.json");
  }

  private isChatGPTCookieDomain(domain: string): boolean {
    const normalized = domain.replace(/^\./, "").toLowerCase();
    return (
      normalized === "chatgpt.com" ||
      normalized.endsWith(".chatgpt.com") ||
      normalized === "openai.com" ||
      normalized.endsWith(".openai.com")
    );
  }

  private async rememberAuthentication(context: BrowserContext): Promise<void> {
    try {
      const cookies = (await context.cookies())
        .filter((cookie) => this.isChatGPTCookieDomain(cookie.domain) && Boolean(cookie.value))
        .map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || "/",
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite,
          ...(cookie.expires > 0 ? { expires: cookie.expires } : {}),
        })) as Parameters<BrowserContext["addCookies"]>[0];

      if (cookies.length === 0) return;

      this.rememberedAuthCookies = cookies;
      await mkdir(this.userDataDirectory, { recursive: true });
      await writeFile(this.authCookieSnapshotPath, JSON.stringify(cookies), { encoding: "utf8", mode: 0o600 });
      console.log(`[ChatGPT] Preserved ${cookies.length} authentication cookies for background handoff.`);
    } catch (error) {
      console.warn("[ChatGPT] Could not preserve authenticated browser cookies:", error);
    }
  }

  private async loadRememberedAuthentication(): Promise<Parameters<BrowserContext["addCookies"]>[0]> {
    if (this.rememberedAuthCookies?.length) return this.rememberedAuthCookies;

    try {
      const raw = await readFile(this.authCookieSnapshotPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      const cookies = parsed.filter(
        (cookie) =>
          cookie &&
          typeof cookie.name === "string" &&
          typeof cookie.value === "string" &&
          typeof cookie.domain === "string" &&
          this.isChatGPTCookieDomain(cookie.domain),
      ) as Parameters<BrowserContext["addCookies"]>[0];

      this.rememberedAuthCookies = cookies;
      return cookies;
    } catch {
      return [];
    }
  }

  private async restoreRememberedAuthentication(context: BrowserContext): Promise<boolean> {
    const cookies = await this.loadRememberedAuthentication();
    if (cookies.length === 0) return false;

    try {
      await context.addCookies(cookies);
      console.log(`[ChatGPT] Restored ${cookies.length} authentication cookies into background browser.`);
      return true;
    } catch (error) {
      console.warn("[ChatGPT] Could not restore authenticated browser cookies:", error);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Browser
  // ---------------------------------------------------------------------------

  private stopWindowsHideGuard(): void {
    const guard = this.windowsHideGuard;
    this.windowsHideGuard = null;

    if (!guard) return;

    try {
      guard.kill();
    } catch {
      // Best-effort cleanup only.
    }
  }

  private startWindowsHideGuard(rootPid: number | null = this.browserProcessPid): void {
    if (process.platform !== "win32" || this.windowsHideGuard || !rootPid) {
      return;
    }

    /*
     * IMPORTANT: do not discover the automation window by profile command line.
     * Chrome moves its real top-level HWND between processes and some descendants
     * no longer carry --user-data-dir in their command line. That was why an
     * apparently hidden browser could still leave a Chrome taskbar button.
     *
     * Instead, anchor the guard to the exact browser PID returned by CreateProcess
     * and follow its complete descendant tree. Every Chrome_WidgetWin_* HWND in
     * that tree is converted to an owned TOOLWINDOW, explicitly removed from the
     * Explorer taskbar, moved off-screen and hidden. Giving the window a hidden
     * owner is the extra Windows-level guarantee: owned top-level windows are not
     * represented as independent taskbar buttons even if Chrome recreates them.
     */
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$rootPid = ${rootPid}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

[ComImport]
[Guid("56FDF342-FD6D-11D0-958A-006097C9A090")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEskanderTaskbarList {
  void HrInit();
  void AddTab(IntPtr hwnd);
  void DeleteTab(IntPtr hwnd);
  void ActivateTab(IntPtr hwnd);
  void SetActiveAlt(IntPtr hwnd);
}

[ComImport]
[Guid("56FDF344-FD6D-11D0-958A-006097C9A090")]
class EskanderTaskbarListCom {}

public static class EskanderNativeWindowGuard {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")]
  public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")]
  public static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr CreateWindowEx(
    int dwExStyle,
    string lpClassName,
    string lpWindowName,
    int dwStyle,
    int x,
    int y,
    int nWidth,
    int nHeight,
    IntPtr hWndParent,
    IntPtr hMenu,
    IntPtr hInstance,
    IntPtr lpParam
  );

  [DllImport("user32.dll")]
  public static extern bool DestroyWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(
    IntPtr hWnd,
    IntPtr hWndInsertAfter,
    int X,
    int Y,
    int cx,
    int cy,
    uint uFlags
  );

  public static bool IsChromeTopLevelWindow(IntPtr hwnd) {
    var className = new StringBuilder(256);
    if (GetClassName(hwnd, className, className.Capacity) <= 0) return false;
    return className.ToString().StartsWith("Chrome_WidgetWin_", StringComparison.OrdinalIgnoreCase);
  }

  public static void DeleteTaskbarTab(IntPtr hwnd) {
    try {
      IEskanderTaskbarList taskbar = (IEskanderTaskbarList)new EskanderTaskbarListCom();
      taskbar.HrInit();
      taskbar.DeleteTab(hwnd);
      Marshal.FinalReleaseComObject(taskbar);
    } catch {}
  }
}
"@ -ErrorAction SilentlyContinue

$GWL_EXSTYLE = -20
$GWLP_HWNDPARENT = -8
$WS_EX_TOOLWINDOW = 0x00000080
$WS_EX_APPWINDOW = 0x00040000
$SWP_NOSIZE = 0x0001
$SWP_NOACTIVATE = 0x0010
$SWP_FRAMECHANGED = 0x0020
$SWP_HIDEWINDOW = 0x0080
$SWP_NOOWNERZORDER = 0x0200
$HWND_BOTTOM = [IntPtr]1

# A permanent hidden owner window suppresses taskbar representation at the
# shell/window-manager level, independently of Chrome's AppUserModelID.
$ownerHwnd = [EskanderNativeWindowGuard]::CreateWindowEx(
  $WS_EX_TOOLWINDOW,
  'STATIC',
  'EskanderChatGPTHiddenOwner',
  0,
  -32000,
  -32000,
  1,
  1,
  [IntPtr]::Zero,
  [IntPtr]::Zero,
  [IntPtr]::Zero,
  [IntPtr]::Zero
)

function Get-EskanderProcessIds {
  $all = @(Get-CimInstance Win32_Process)
  $ids = New-Object 'System.Collections.Generic.HashSet[int]'
  [void]$ids.Add([int]$rootPid)

  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($item in $all) {
      if ($ids.Contains([int]$item.ParentProcessId) -and -not $ids.Contains([int]$item.ProcessId)) {
        [void]$ids.Add([int]$item.ProcessId)
        $changed = $true
      }
    }
  }

  return $ids
}

try {
  while ($true) {
    # Stop with the browser rather than leaving a guard process behind.
    if (-not (Get-Process -Id $rootPid -ErrorAction SilentlyContinue)) { break }

    $profilePids = Get-EskanderProcessIds

    [EskanderNativeWindowGuard]::EnumWindows({
      param([IntPtr]$hwnd, [IntPtr]$lParam)

      [uint32]$windowPid = 0
      [void][EskanderNativeWindowGuard]::GetWindowThreadProcessId($hwnd, [ref]$windowPid)

      if ($profilePids.Contains([int]$windowPid) -and [EskanderNativeWindowGuard]::IsChromeTopLevelWindow($hwnd)) {
        try {
          # Make it an owned tool window FIRST. This is stronger than DeleteTab
          # alone and prevents Explorer from recreating a grouped Chrome button.
          if ($ownerHwnd -ne [IntPtr]::Zero) {
            [EskanderNativeWindowGuard]::SetWindowLongPtr64($hwnd, $GWLP_HWNDPARENT, $ownerHwnd) | Out-Null
          }

          $stylePtr = [EskanderNativeWindowGuard]::GetWindowLongPtr64($hwnd, $GWL_EXSTYLE)
          $style = $stylePtr.ToInt64()
          $style = ($style -bor $WS_EX_TOOLWINDOW) -band (-bnot $WS_EX_APPWINDOW)
          [EskanderNativeWindowGuard]::SetWindowLongPtr64($hwnd, $GWL_EXSTYLE, [IntPtr]$style) | Out-Null

          [EskanderNativeWindowGuard]::DeleteTaskbarTab($hwnd)
          [EskanderNativeWindowGuard]::SetWindowPos(
            $hwnd,
            $HWND_BOTTOM,
            -32000,
            -32000,
            0,
            0,
            ($SWP_NOSIZE -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED -bor $SWP_HIDEWINDOW -bor $SWP_NOOWNERZORDER)
          ) | Out-Null
          [EskanderNativeWindowGuard]::ShowWindowAsync($hwnd, 0) | Out-Null
        } catch {}
      }

      return $true
    }, [IntPtr]::Zero) | Out-Null

    Start-Sleep -Milliseconds 25
  }
} finally {
  if ($ownerHwnd -ne [IntPtr]::Zero) {
    [EskanderNativeWindowGuard]::DestroyWindow($ownerHwnd) | Out-Null
  }
}
`;

    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      {
        windowsHide: true,
        detached: false,
        stdio: "ignore",
      },
    );

    this.windowsHideGuard = child;
    child.on("exit", () => {
      if (this.windowsHideGuard === child) this.windowsHideGuard = null;
    });
  }

  private async setWindowsProfileWindowVisibility(visible: boolean): Promise<void> {
    if (process.platform !== "win32") {
      return;
    }

    if (!visible) {
      this.startWindowsHideGuard(this.browserProcessPid);
    } else {
      this.stopWindowsHideGuard();
    }

    const profile = this.userDataDirectory;
    const show = visible ? "$true" : "$false";
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$profile = ${JSON.stringify(profile)}
$show = ${show}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport]
[Guid("56FDF342-FD6D-11D0-958A-006097C9A090")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEskanderTaskbarListOnce {
  void HrInit();
  void AddTab(IntPtr hwnd);
  void DeleteTab(IntPtr hwnd);
  void ActivateTab(IntPtr hwnd);
  void SetActiveAlt(IntPtr hwnd);
}

[ComImport]
[Guid("56FDF344-FD6D-11D0-958A-006097C9A090")]
class EskanderTaskbarListOnceCom {}

public static class EskanderNativeWindowOnce {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")]
  public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")]
  public static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

  public static bool IsChromeTopLevelWindow(IntPtr hwnd) {
    var className = new System.Text.StringBuilder(256);
    if (GetClassName(hwnd, className, className.Capacity) <= 0) return false;
    return className.ToString().StartsWith("Chrome_WidgetWin_", StringComparison.OrdinalIgnoreCase);
  }

  public static void SetTaskbarTab(IntPtr hwnd, bool visible) {
    try {
      IEskanderTaskbarListOnce taskbar = (IEskanderTaskbarListOnce)new EskanderTaskbarListOnceCom();
      taskbar.HrInit();
      if (visible) taskbar.AddTab(hwnd); else taskbar.DeleteTab(hwnd);
      Marshal.FinalReleaseComObject(taskbar);
    } catch {}
  }
}
"@ -ErrorAction SilentlyContinue

$GWL_EXSTYLE = -20
$WS_EX_TOOLWINDOW = 0x00000080
$WS_EX_APPWINDOW = 0x00040000

$all = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^(chrome|msedge|chromium)\\.exe$'
})
$profilePids = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($item in $all) {
  if ($item.CommandLine -and $item.CommandLine.IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    [void]$profilePids.Add([int]$item.ProcessId)
  }
}
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($item in $all) {
    if ($profilePids.Contains([int]$item.ParentProcessId) -and -not $profilePids.Contains([int]$item.ProcessId)) {
      [void]$profilePids.Add([int]$item.ProcessId)
      $changed = $true
    }
  }
}

[EskanderNativeWindowOnce]::EnumWindows({
  param([IntPtr]$hwnd, [IntPtr]$lParam)

  [uint32]$windowPid = 0
  [void][EskanderNativeWindowOnce]::GetWindowThreadProcessId($hwnd, [ref]$windowPid)

  if ($profilePids.Contains([int]$windowPid) -and [EskanderNativeWindowOnce]::IsChromeTopLevelWindow($hwnd)) {
    try {
      $stylePtr = [EskanderNativeWindowOnce]::GetWindowLongPtr64($hwnd, $GWL_EXSTYLE)
      $style = $stylePtr.ToInt64()

      if ($show) {
        # Manual Connect must be visible so the user can sign in, but it still
        # must not publish a Chrome button in the Windows taskbar. Keep it a
        # TOOLWINDOW, explicitly remove any shell tab, then restore/show it.
        $style = ($style -bor $WS_EX_TOOLWINDOW) -band (-bnot $WS_EX_APPWINDOW)
        [EskanderNativeWindowOnce]::SetWindowLongPtr64($hwnd, $GWL_EXSTYLE, [IntPtr]$style) | Out-Null
        [EskanderNativeWindowOnce]::SetTaskbarTab($hwnd, $false)
        [EskanderNativeWindowOnce]::ShowWindowAsync($hwnd, 9) | Out-Null
      } else {
        $style = ($style -bor $WS_EX_TOOLWINDOW) -band (-bnot $WS_EX_APPWINDOW)
        [EskanderNativeWindowOnce]::SetWindowLongPtr64($hwnd, $GWL_EXSTYLE, [IntPtr]$style) | Out-Null
        [EskanderNativeWindowOnce]::SetTaskbarTab($hwnd, $false)
        [EskanderNativeWindowOnce]::ShowWindowAsync($hwnd, 0) | Out-Null
      }
    } catch {}
  }

  return $true
}, [IntPtr]::Zero) | Out-Null
`;

    const encoded = Buffer.from(script, "utf16le").toString("base64");

    await new Promise<void>((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        { windowsHide: true, timeout: 10_000 },
        () => resolve(),
      );
    });
  }

  private async setContextWindowVisibility(context: BrowserContext, visible: boolean): Promise<void> {
    const page = context.pages().find((candidate) => !candidate.isClosed());

    if (visible) {
      await this.setWindowsProfileWindowVisibility(true).catch(() => undefined);
    }

    if (page) {
      let cdpSession: CDPSession | null = null;

      try {
        cdpSession = await context.newCDPSession(page);
        const { windowId } = await cdpSession.send("Browser.getWindowForTarget");

        if (visible) {
          await cdpSession.send("Browser.setWindowBounds", {
            windowId,
            bounds: {
              windowState: "normal",
              left: 80,
              top: 70,
              width: 1440,
              height: 1000,
            },
          });
        } else {
          /*
           * Do not minimize: a minimized headful Chrome can register itself in
           * the Windows taskbar even if we hide it a moment later. Keep it in
           * a normal off-screen state and let the native guard remove/hide the
           * HWND without ever creating a visible minimized taskbar entry.
           */
          await cdpSession.send("Browser.setWindowBounds", {
            windowId,
            bounds: {
              windowState: "normal",
              left: -32000,
              top: -32000,
              width: 1440,
              height: 1000,
            },
          });
        }
      } catch (error) {
        console.warn("[ChatGPT] Could not update automation window bounds:", error);
      } finally {
        await cdpSession?.detach().catch(() => undefined);
      }
    }

    if (!visible) {
      // SW_HIDE removes the dedicated automation Chrome window from the Windows
      // taskbar while keeping the exact authenticated, headful browser alive.
      // Retry briefly because Chrome can recreate its top-level HWND during
      // startup/navigation.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await this.setWindowsProfileWindowVisibility(false).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
    }
  }

  private async launchChromeHiddenOnInteractiveDesktop(
    executablePath: string,
    args: string[],
  ): Promise<number> {
    if (process.platform !== "win32") {
      throw new Error("Hidden Windows Chrome launch is only available on Windows.");
    }

    const exeBase64 = Buffer.from(executablePath, "utf8").toString("base64");
    const argsBase64 = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
    const script = `
$ErrorActionPreference = 'Stop'
$exe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${exeBase64}'))
$argsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${argsBase64}'))
$argsList = ConvertFrom-Json $argsJson

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class EskanderHiddenChromeLauncher {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public int dwX;
    public int dwY;
    public int dwXSize;
    public int dwYSize;
    public int dwXCountChars;
    public int dwYCountChars;
    public int dwFillAttribute;
    public int dwFlags;
    public short wShowWindow;
    public short cbReserved2;
    public IntPtr lpReserved2;
    public IntPtr hStdInput;
    public IntPtr hStdOutput;
    public IntPtr hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION {
    public IntPtr hProcess;
    public IntPtr hThread;
    public uint dwProcessId;
    public uint dwThreadId;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CreateProcess(
    string lpApplicationName,
    StringBuilder lpCommandLine,
    IntPtr lpProcessAttributes,
    IntPtr lpThreadAttributes,
    bool bInheritHandles,
    uint dwCreationFlags,
    IntPtr lpEnvironment,
    string lpCurrentDirectory,
    ref STARTUPINFO lpStartupInfo,
    out PROCESS_INFORMATION lpProcessInformation
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr hObject);
}
"@

function Quote-Arg([string]$value) {
  if ($null -eq $value) { return '""' }
  if ($value -notmatch '[\\s"]') { return $value }
  return '"' + ($value -replace '(\\*)"', '$1$1\\"' -replace '(\\+)$', '$1$1') + '"'
}

$si = New-Object EskanderHiddenChromeLauncher+STARTUPINFO
$si.cb = [Runtime.InteropServices.Marshal]::SizeOf([type][EskanderHiddenChromeLauncher+STARTUPINFO])
# Keep Chrome on the normal interactive desktop so networking, GPU and DevTools
# initialize exactly like a normal browser. STARTF_USESHOWWINDOW + SW_HIDE means
# the first top-level Chrome HWND starts hidden rather than flashing/minimizing.
$si.lpDesktop = 'winsta0\\default'
$si.dwFlags = 1
$si.wShowWindow = 0

$quotedArgs = @($argsList | ForEach-Object { Quote-Arg ([string]$_) })
$commandLine = New-Object Text.StringBuilder
[void]$commandLine.Append((Quote-Arg $exe))
if ($quotedArgs.Count -gt 0) {
  [void]$commandLine.Append(' ')
  [void]$commandLine.Append(($quotedArgs -join ' '))
}

$pi = New-Object EskanderHiddenChromeLauncher+PROCESS_INFORMATION
$CREATE_UNICODE_ENVIRONMENT = [uint32]0x00000400
$CREATE_NEW_PROCESS_GROUP = [uint32]0x00000200
$created = [EskanderHiddenChromeLauncher]::CreateProcess(
  $exe,
  $commandLine,
  [IntPtr]::Zero,
  [IntPtr]::Zero,
  $false,
  ($CREATE_UNICODE_ENVIRONMENT -bor $CREATE_NEW_PROCESS_GROUP),
  [IntPtr]::Zero,
  [IO.Path]::GetDirectoryName($exe),
  [ref]$si,
  [ref]$pi
)

if (-not $created) {
  throw "CreateProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}

try {
  Write-Output $pi.dwProcessId
} finally {
  if ($pi.hThread -ne [IntPtr]::Zero) { [EskanderHiddenChromeLauncher]::CloseHandle($pi.hThread) | Out-Null }
  if ($pi.hProcess -ne [IntPtr]::Zero) { [EskanderHiddenChromeLauncher]::CloseHandle($pi.hProcess) | Out-Null }
}
`;

    const encoded = Buffer.from(script, "utf16le").toString("base64");

    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        { windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Could not launch hidden ChatGPT Chrome: ${stderr || error.message}`));
            return;
          }
          resolve(stdout.trim());
        },
      );
    });

    const pid = Number.parseInt(output.split(/\r?\n/).filter(Boolean).at(-1) ?? "", 10);
    if (!Number.isFinite(pid) || pid <= 0) {
      throw new Error(`Hidden Chrome launcher returned an invalid PID: ${output || "<empty>"}`);
    }

    console.log(`[ChatGPT] Hidden headful Chrome started with PID ${pid} on the interactive desktop.`);
    return pid;
  }

  private async reserveLoopbackPort(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
      const server = createServer();

      server.unref();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close(() => reject(new Error("Could not reserve a local DevTools port.")));
          return;
        }

        const port = address.port;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      });
    });
  }

  private async isWindowsProcessAlive(pid: number): Promise<boolean> {
    if (process.platform !== "win32") return true;

    return await new Promise<boolean>((resolve) => {
      execFile(
        "tasklist.exe",
        ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
        { windowsHide: true, timeout: 4_000, maxBuffer: 128 * 1024 },
        (error, stdout) => {
          if (error) {
            resolve(false);
            return;
          }

          resolve(stdout.includes(`"${pid}"`) || new RegExp(`(?:^|[,\s])${pid}(?:[,\s]|$)`).test(stdout));
        },
      );
    });
  }

  private async waitForDevToolsEndpoint(
    port: number,
    child: ChildProcess | null = null,
    windowsPid: number | null = null,
  ): Promise<string> {
    const endpoint = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    let lastError: unknown = null;

    while (Date.now() < deadline) {
      if (child && child.exitCode !== null) {
        throw new Error(`Hidden ChatGPT Chrome exited before DevTools was ready (code ${child.exitCode}).`);
      }

      if (windowsPid && !(await this.isWindowsProcessAlive(windowsPid))) {
        throw new Error(`Hidden ChatGPT Chrome process ${windowsPid} exited before DevTools was ready.`);
      }

      try {
        const response = await fetch(`${endpoint}/json/version`, {
          signal: AbortSignal.timeout(1_500),
        });

        if (response.ok) {
          const data = (await response.json().catch(() => null)) as { webSocketDebuggerUrl?: string } | null;
          if (data?.webSocketDebuggerUrl) {
            console.log(`[ChatGPT] Hidden Chrome DevTools endpoint ready on 127.0.0.1:${port}.`);
            return endpoint;
          }
        } else {
          lastError = new Error(`DevTools HTTP status ${response.status}`);
        }
      } catch (error) {
        lastError = error;
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    throw new Error(
      `Hidden ChatGPT Chrome did not expose DevTools on 127.0.0.1:${port} in time${
        lastError instanceof Error ? `: ${lastError.message}` : "."
      }`,
    );
  }

  private async launchHiddenHeadfulContext(): Promise<BrowserContext> {
    await mkdir(this.userDataDirectory, { recursive: true });

    const executablePath = requireBrowserExecutablePath();
    const devToolsPort = await this.reserveLoopbackPort();

    console.log(`[ChatGPT] Browser executable: ${executablePath}`);
    console.log(`[ChatGPT] Profile directory: ${this.userDataDirectory}`);
    console.log("[ChatGPT] Launching hidden headful Chrome for background automation.");

    /*
     * ChatGPT rejects the authenticated profile when Chromium runs with the
     * --headless flag. On Windows we therefore run real headful Chrome, but
     * create it hidden from the first Win32 frame (STARTUPINFO/SW_HIDE). The
     * native guard is already running before Chrome starts, so any top-level
     * HWND Chrome recreates is immediately stripped from Explorer's taskbar.
     * This keeps normal Chrome networking/DevTools behavior without a visible
     * window or taskbar button.
     *
     * Non-Windows builds keep the off-screen headful fallback.
     */
    const chromeArgs = [
      `--user-data-dir=${this.userDataDirectory}`,
      "--profile-directory=Default",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${devToolsPort}`,
      "--disable-blink-features=AutomationControlled",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculateNativeWinOcclusion",
      "--lang=en-US",
      "--window-size=1440,1000",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ];

    let child: ChildProcess | null = null;

    if (process.platform === "win32") {
      this.browserProcessPid = await this.launchChromeHiddenOnInteractiveDesktop(executablePath, chromeArgs);
      // CreateProcess starts the first frame with SW_HIDE. As soon as we have the
      // exact root PID, attach the native owner/taskbar guard to that process
      // tree so Chrome descendants can never publish a taskbar button.
      this.startWindowsHideGuard(this.browserProcessPid);
    } else {
      child = spawn(executablePath, [...chromeArgs, "--window-position=-32000,-32000"], {
        detached: false,
        stdio: "ignore",
      });
      this.browserProcess = child;
      this.browserProcessPid = child.pid ?? null;
      child.on("exit", () => {
        if (this.browserProcess === child) this.browserProcess = null;
        if (this.browserProcessPid === child?.pid) this.browserProcessPid = null;
      });
    }

    let endpoint: string;
    try {
      endpoint = await this.waitForDevToolsEndpoint(
        devToolsPort,
        child,
        process.platform === "win32" ? this.browserProcessPid : null,
      );
    } catch (error) {
      const failedPid = this.browserProcessPid;
      this.browserProcessPid = null;
      if (process.platform === "win32" && failedPid) {
        await new Promise<void>((resolve) => {
          execFile(
            "taskkill.exe",
            ["/PID", String(failedPid), "/T", "/F"],
            { windowsHide: true, timeout: 8_000 },
            () => resolve(),
          );
        });
      }
      throw error;
    }

    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];

    if (!context) {
      await browser.close().catch(() => undefined);
      throw new Error("Hidden ChatGPT Chrome started without a usable browser context.");
    }

    this.browser = browser;
    this.context = context;

    browser.on("disconnected", () => {
      if (this.browser === browser) this.browser = null;
      if (this.context === context) this.context = null;
      this.browserProcessPid = null;
      this.stopWindowsHideGuard();
    });

    await this.restoreRememberedAuthentication(context);
    if (process.platform === "win32") {
      // A CDP attach/navigation can cause Chrome to recreate its top-level HWND.
      // Re-apply the one-shot hide immediately; the persistent guard continues
      // enforcing the same state in the background.
      await this.setWindowsProfileWindowVisibility(false).catch(() => undefined);
    } else {
      await this.setContextWindowVisibility(context, false).catch(() => undefined);
    }

    return context;
  }

  private async findChromeRootPidForProfile(): Promise<number | null> {
    if (process.platform !== "win32") return null;

    const profileBase64 = Buffer.from(this.userDataDirectory, "utf8").toString("base64");
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$profile = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${profileBase64}'))
$items = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^(chrome|msedge|chromium)\.exe$' -and
  $_.CommandLine -and
  $_.CommandLine.IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
})
if ($items.Count -eq 0) { exit 0 }
$ids = @{}
foreach ($item in $items) { $ids[[int]$item.ProcessId] = $true }
$root = $items | Where-Object { -not $ids.ContainsKey([int]$_.ParentProcessId) } | Select-Object -First 1
if (-not $root) { $root = $items | Select-Object -First 1 }
if ($root) { Write-Output $root.ProcessId }
`;

    const encoded = Buffer.from(script, "utf16le").toString("base64");

    return await new Promise<number | null>((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        { windowsHide: true, timeout: 10_000 },
        (error, stdout) => {
          if (error) return resolve(null);
          const value = Number.parseInt(String(stdout).trim(), 10);
          resolve(Number.isFinite(value) && value > 0 ? value : null);
        },
      );
    });
  }

  private async cleanupStaleProfileProcesses(): Promise<void> {
    if (process.platform !== "win32") return;

    this.stopWindowsHideGuard();

    const profileBase64 = Buffer.from(this.userDataDirectory, "utf8").toString("base64");
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$profile = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${profileBase64}'))
$items = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^(chrome|msedge|chromium)\.exe$' -and
  $_.CommandLine -and
  $_.CommandLine.IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
})
foreach ($item in $items) {
  Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
}
`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");

    await new Promise<void>((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        { windowsHide: true, timeout: 10_000 },
        () => resolve(),
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 350));
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      await rm(join(this.userDataDirectory, name), { force: true }).catch(() => undefined);
    }
  }

  private async launchSharedPersistentContext(options?: { visible?: boolean; cleanupFirst?: boolean }): Promise<BrowserContext> {
    const visible = Boolean(options?.visible);

    if (options?.cleanupFirst) {
      await this.cleanupStaleProfileProcesses();
    }

    await mkdir(this.userDataDirectory, { recursive: true });
    const executablePath = requireBrowserExecutablePath();

    console.log(`[ChatGPT] Browser executable: ${executablePath}`);
    console.log(`[ChatGPT] Profile directory: ${this.userDataDirectory}`);
    console.log(`[ChatGPT] Launching shared persistent context (${visible ? "manual login" : "background"}).`);

    const context = await chromium.launchPersistentContext(this.userDataDirectory, {
      executablePath,
      // ChatGPT rejects this authenticated profile when reopened in true
      // headless mode (403). Keep one headed persistent context, exactly like
      // Gemini's shared-context lifecycle, and hide only its native HWND.
      headless: false,
      viewport: { width: 1440, height: 1000 },
      locale: "en-US",
      args: [
        "--profile-directory=Default",
        "--disable-blink-features=AutomationControlled",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=CalculateNativeWinOcclusion",
        "--lang=en-US",
        "--window-size=1440,1000",
        ...(visible ? [] : ["--window-position=-32000,-32000"]),
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    this.context = context;
    this.manualLoginContext = null;
    this.manualLoginVisible = visible;

    context.on("close", () => {
      if (this.context === context) this.context = null;
      this.manualLoginContext = null;
      this.manualLoginVisible = false;
      this.browserProcessPid = null;
      this.stopWindowsHideGuard();
    });

    await this.restoreRememberedAuthentication(context);

    if (process.platform === "win32") {
      for (let attempt = 0; attempt < 25 && !this.browserProcessPid; attempt += 1) {
        this.browserProcessPid = await this.findChromeRootPidForProfile();
        if (!this.browserProcessPid) await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (visible) {
        // Manual login stays visible but remains a TOOLWINDOW so it does not
        // publish a separate Chrome button in the Windows taskbar.
        await this.setWindowsProfileWindowVisibility(true).catch(() => undefined);
      } else {
        this.startWindowsHideGuard(this.browserProcessPid);
        await this.setContextWindowVisibility(context, false).catch(() => undefined);
      }
    } else if (!visible) {
      await this.setContextWindowVisibility(context, false).catch(() => undefined);
    }

    return context;
  }

  private async getContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (this.contextPromise) return this.contextPromise;

    this.contextPromise = this.launchSharedPersistentContext({ visible: false, cleanupFirst: true });

    try {
      return await this.contextPromise;
    } catch (error) {
      // Never leave a crashed Chrome/profile lock behind. A reconnect must be
      // able to open the same dedicated profile immediately.
      await this.cleanupStaleProfileProcesses().catch(() => undefined);
      throw error;
    } finally {
      this.contextPromise = null;
    }
  }

  private async createJobPage(): Promise<Page> {
    const context = await this.getContext();

    if (this.manualLoginVisible) {
      this.manualLoginVisible = false;
      if (process.platform === "win32") {
        this.startWindowsHideGuard(this.browserProcessPid);
      }
      await this.setContextWindowVisibility(context, false).catch(() => undefined);
    }

    const page = await context.newPage();
    await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    return page;
  }

  private async closeAutomationContext(): Promise<void> {
    if (this.contextPromise) {
      await this.contextPromise.catch(() => undefined);
      this.contextPromise = null;
    }

    const context = this.context;
    this.context = null;
    this.manualLoginContext = null;
    this.manualLoginVisible = false;
    this.browser = null;
    this.browserProcess = null;
    this.browserProcessPid = null;
    this.stopWindowsHideGuard();

    if (context) {
      try {
        await context.close();
      } catch (error) {
        console.warn("[ChatGPT] Could not close persistent browser context:", error);
      }
    }

    // Chrome occasionally exits before Playwright finishes its own cleanup.
    // Remove only processes that explicitly belong to Eskander's ChatGPT
    // profile; normal user Chrome sessions are never touched.
    await this.cleanupStaleProfileProcesses().catch(() => undefined);
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  private async hasAuthenticatedSession(page: Page): Promise<boolean> {
    try {
      const result = await page.evaluate(async () => {
        try {
          const response = await fetch("/api/auth/session", {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          });

          if (!response.ok) {
            return {
              connected: false,
              status: response.status,
            };
          }

          const data = await response.json();

          return {
            connected: Boolean(data?.user || data?.accessToken || data?.expires),
            status: response.status,
          };
        } catch {
          return {
            connected: false,
            status: 0,
          };
        }
      });

      console.log("[ChatGPT] Session check:", result);

      return result.connected;
    } catch (error) {
      console.warn("[ChatGPT] Session check failed:", error);

      return false;
    }
  }

  /**
   * Probe the canonical ChatGPT session endpoint by navigating a real page in
   * the exact BrowserContext that owns the login profile. This deliberately
   * avoids depending on account-button selectors, page hydration, or an
   * in-page fetch that can be affected by the current route.
   *
   * Never log or return the access token itself.
   */
  private async probeAuthenticatedSession(context: BrowserContext): Promise<boolean> {
    let probePage: Page | null = null;

    try {
      probePage = await context.newPage();

      const response = await probePage.goto(CHATGPT_SESSION_URL, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      const status = response?.status() ?? 0;
      const bodyText = await probePage.locator("body").innerText({ timeout: 10_000 }).catch(() => "");

      let data: any = null;

      try {
        data = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        // Chrome can occasionally render a non-JSON interstitial/challenge.
      }

      const connected = Boolean(
        status >= 200 &&
          status < 300 &&
          (data?.user?.id || data?.user?.email || data?.user || data?.accessToken),
      );

      console.log("[ChatGPT] Direct session probe:", {
        status,
        connected,
        hasUser: Boolean(data?.user),
        hasAccessToken: Boolean(data?.accessToken),
      });

      return connected;
    } catch (error) {
      console.warn("[ChatGPT] Direct session probe failed:", error);
      return false;
    } finally {
      if (probePage && !probePage.isClosed()) {
        await probePage.close().catch(() => undefined);
      }
    }
  }

  private async hasAuthenticatedSessionCookie(page: Page): Promise<boolean> {
    try {
      const cookies = await page.context().cookies();
      const knownSessionCookieNames = new Set([
        "__Secure-next-auth.session-token",
        "next-auth.session-token",
        "__Secure-authjs.session-token",
        "authjs.session-token",
      ]);

      return cookies.some((cookie) => {
        const domain = cookie.domain.replace(/^\./, "").toLowerCase();
        const isChatGPTDomain =
          domain === "chatgpt.com" ||
          domain.endsWith(".chatgpt.com") ||
          domain === "openai.com" ||
          domain.endsWith(".openai.com");

        if (!isChatGPTDomain) return false;
        if (knownSessionCookieNames.has(cookie.name)) return Boolean(cookie.value);

        // Keep this intentionally narrow. Tracking/device cookies such as
        // oai-did or cf_clearance are not proof of an authenticated account.
        return /(?:^|[._-])(session|access|refresh)[._-]?(?:token)?$/i.test(cookie.name) && Boolean(cookie.value);
      });
    } catch (error) {
      console.warn("[ChatGPT] Could not inspect session cookies:", error);
      return false;
    }
  }

  private async hasAuthenticatedAccount(page: Page): Promise<boolean> {
    const selectors = [
      '[data-testid="accounts-profile-button"]',
      '[data-testid="profile-button"]',
      '[data-testid="user-menu-button"]',
      '[data-testid*="profile"]',
      '[aria-label="Open profile menu"]',
      'button[aria-label*="profile" i]',
      'button[aria-label*="account" i]',
      'button[aria-label*="الحساب" i]',
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count();

      for (let index = count - 1; index >= 0; index--) {
        const candidate = locator.nth(index);

        try {
          if (await candidate.isVisible()) {
            console.log(`[ChatGPT] Authenticated account control found: ${selector}`);

            return true;
          }
        } catch {
          // Try next candidate.
        }
      }
    }

    return false;
  }


  private async hasVisibleSignedOutGate(page: Page): Promise<boolean> {
    const selectors = [
      'a[href*="/auth/login"]',
      'button:has-text("Log in")',
      'a:has-text("Log in")',
      'button:has-text("Sign up")',
      'a:has-text("Sign up")',
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count();
      for (let index = 0; index < count; index += 1) {
        try {
          if (await locator.nth(index).isVisible()) return true;
        } catch {
          // Ignore transient hydration changes.
        }
      }
    }

    return false;
  }

  /**
   * One authentication entry point for the whole provider.
   *
   * Session endpoint is the primary signal.
   * Account UI is a fallback because ChatGPT UI/session internals can change.
   */
  private async isAuthenticated(page: Page): Promise<boolean> {
    const [sessionAuthenticated, accountAuthenticated, cookieAuthenticated] = await Promise.all([
      this.hasAuthenticatedSession(page),
      this.hasAuthenticatedAccount(page),
      this.hasAuthenticatedSessionCookie(page),
    ]);

    if (sessionAuthenticated || accountAuthenticated || cookieAuthenticated) {
      return true;
    }

    return false;
  }

  private async ensureLoggedIn(page: Page): Promise<Locator> {
    /*
     * ChatGPT changes its session endpoint and account-menu markup fairly
     * often. Treat a usable composer with no visible sign-in gate as a valid
     * connected session, while still preferring the explicit session/account
     * checks when they are available.
     */
    const deadline = Date.now() + 20_000;
    let authenticated = false;

    while (Date.now() < deadline) {
      const composer = await this.findComposer(page);
      authenticated = await this.isAuthenticated(page);

      if (composer && authenticated) {
        return composer;
      }

      if (composer && !(await this.hasVisibleSignedOutGate(page))) {
        console.log("[ChatGPT] Composer is usable and no sign-in gate is visible; accepting session.");
        return composer;
      }

      await page.waitForTimeout(500);
    }

    if (!authenticated) {
      // One last auth handoff retry for session-only cookies. This specifically
      // covers the transition from the visible Settings login to headless jobs.
      const restored = await this.restoreRememberedAuthentication(page.context());
      if (restored) {
        await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
        const composer = await this.findComposer(page);
        const recoveredAuth = await this.isAuthenticated(page);
        if (composer && (recoveredAuth || !(await this.hasVisibleSignedOutGate(page)))) {
          console.log("[ChatGPT] Background session recovered from preserved authentication cookies.");
          return composer;
        }
      }

      await this.dumpDebugInfo(page).catch(() => undefined);
      throw new ChatGPTLoginRequiredError();
    }

    throw new Error("ChatGPT is connected, but the prompt composer could not be found.");
  }

  async openManualLogin(): Promise<void> {
    if (this.activeJobCount > 0) {
      throw new Error(
        `ChatGPT is currently processing ${this.activeJobCount} prompt${
          this.activeJobCount === 1 ? "" : "s"
        }. Wait for generation to finish before reconnecting.`,
      );
    }

    // Reconnect starts from one clean persistent context, just like Gemini.
    // The important difference from the broken handoff flow is that this same
    // context stays alive after login and becomes the generation context.
    await this.closeAutomationContext();
    await this.cleanupStaleProfileProcesses();

    const context = await this.launchSharedPersistentContext({ visible: true, cleanupFirst: false });
    let page =
      [...context.pages()]
        .reverse()
        .find(
          (candidate) =>
            !candidate.isClosed() &&
            candidate.url().startsWith(CHATGPT_URL) &&
            !candidate.url().includes("/api/auth/session"),
        ) ?? null;

    if (!page) page = await context.newPage();

    if (!page.url().startsWith(CHATGPT_URL) || page.url().includes("/api/auth/session")) {
      await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }

    await page.bringToFront().catch(() => undefined);
    console.log("[ChatGPT] Manual login browser opened using the shared persistent context.");
  }

  async checkConnection(): Promise<ConnectionStatus> {
    let page: Page | null = null;
    let temporaryPage = false;

    try {
      console.log("[ChatGPT] Checking connection...");

      // First-run Settings checks must not launch Chrome just to discover that
      // no login has ever been saved. This mirrors Gemini's cheap status path
      // and avoids grabbing the profile before the user clicks Connect.
      if (!this.context && !this.manualLoginVisible) {
        const remembered = await this.loadRememberedAuthentication();
        if (remembered.length === 0) {
          return { connected: false, message: "ChatGPT sign in is required." };
        }
      }

      const context = this.context ?? (await this.getContext());
      const sessionAuthenticated = await this.probeAuthenticatedSession(context);

      if (sessionAuthenticated) {
        await this.rememberAuthentication(context);

        if (this.manualLoginVisible) {
          this.manualLoginVisible = false;
          if (process.platform === "win32") this.startWindowsHideGuard(this.browserProcessPid);
          await this.setContextWindowVisibility(context, false).catch(() => undefined);
        }

        return {
          connected: true,
          message: "ChatGPT is connected and ready for background generation.",
        };
      }

      page =
        [...context.pages()]
          .reverse()
          .find(
            (candidate) =>
              !candidate.isClosed() &&
              candidate.url().startsWith(CHATGPT_URL) &&
              !candidate.url().includes("/api/auth/session"),
          ) ?? null;

      if (!page) {
        page = await context.newPage();
        temporaryPage = !this.manualLoginVisible;
        await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      }

      const [pageSessionAuthenticated, accountAuthenticated, composer] = await Promise.all([
        this.hasAuthenticatedSession(page),
        this.hasAuthenticatedAccount(page),
        this.findComposer(page),
      ]);

      const usableComposerSession = Boolean(composer) && !(await this.hasVisibleSignedOutGate(page));
      const connected = pageSessionAuthenticated || accountAuthenticated || usableComposerSession;

      if (connected) {
        await this.rememberAuthentication(context);

        if (this.manualLoginVisible) {
          this.manualLoginVisible = false;
          if (process.platform === "win32") this.startWindowsHideGuard(this.browserProcessPid);
          await this.setContextWindowVisibility(context, false).catch(() => undefined);
        }

        return {
          connected: true,
          message: "ChatGPT is connected and ready for background generation.",
        };
      }

      if (!this.manualLoginVisible) {
        // A failed background status check should release the dedicated profile
        // immediately, so the next manual Connect cannot collide with it.
        await this.closeAutomationContext();
      }

      return {
        connected: false,
        message: this.manualLoginVisible
          ? "Finish signing in to ChatGPT in the opened window. Eskander will detect it automatically."
          : "ChatGPT sign in is required.",
      };
    } catch (error) {
      console.error("[ChatGPT] Connection check failed:", error);

      if (!this.manualLoginVisible) {
        await this.closeAutomationContext().catch(() => undefined);
      }

      return {
        connected: false,
        message: error instanceof Error ? error.message : "Could not check ChatGPT connection.",
      };
    } finally {
      if (temporaryPage && page && !page.isClosed()) {
        await page.close().catch(() => undefined);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Composer
  // ---------------------------------------------------------------------------

  private async findComposer(page: Page): Promise<Locator | null> {
    const selectors = [
      "#prompt-textarea",
      '[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Ask" i]',
      "textarea",
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count();

      for (let index = count - 1; index >= 0; index--) {
        const candidate = locator.nth(index);

        try {
          if (await candidate.isVisible()) {
            return candidate;
          }
        } catch {
          // Try next candidate.
        }
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Image Upload
  // ---------------------------------------------------------------------------

  private async getVisibleAttachmentEvidenceCount(page: Page): Promise<number> {
    const selectors = [
      'button[aria-label*="Remove file" i]',
      'button[aria-label*="Remove attachment" i]',
      'button[aria-label*="إزالة الملف"]',
      'button[aria-label*="إزالة المرفق"]',
      '[data-testid*="attachment"]',
      'img[src^="blob:"]',
    ];

    let maxVisibleCount = 0;

    for (const selector of selectors) {
      const locator = page.locator(selector);
      const count = await locator.count().catch(() => 0);
      let visibleCount = 0;

      for (let index = 0; index < count; index += 1) {
        if (await locator.nth(index).isVisible().catch(() => false)) {
          visibleCount += 1;
        }
      }

      maxVisibleCount = Math.max(maxVisibleCount, visibleCount);
    }

    return maxVisibleCount;
  }

  private async uploadImage(page: Page, imagePath: string, label = "source image"): Promise<void> {
    console.log(`[ChatGPT] Uploading ${label}:`, imagePath);

    const baselineAttachmentCount =
      await this.getVisibleAttachmentEvidenceCount(page);

    /*
     * ChatGPT commonly keeps a hidden file input mounted
     * around the composer.
     */
    let fileInputs = page.locator('input[type="file"]');

    if ((await fileInputs.count()) > 0) {
      await fileInputs.last().setInputFiles(imagePath);

      await this.waitForAttachment(page, label, baselineAttachmentCount);

      return;
    }

    /*
     * Fallback: open the attachment menu first.
     */
    const attachmentSelectors = [
      '[data-testid="composer-plus-btn"]',
      'button[aria-label*="Attach" i]',
      'button[aria-label*="Add files" i]',
      'button[aria-label*="Upload" i]',
      'button[aria-label*="إرفاق"]',
      'button[aria-label*="إضافة"]',
    ];

    let attachmentControlFound = false;

    for (const selector of attachmentSelectors) {
      const locator = page.locator(selector);

      if ((await locator.count()) === 0) {
        continue;
      }

      const candidate = locator.last();

      try {
        if (!(await candidate.isVisible())) {
          continue;
        }

        await candidate.click({
          force: true,
          timeout: 5000,
        });

        attachmentControlFound = true;

        console.log(`[ChatGPT] Attachment control clicked: ${selector}`);

        break;
      } catch {
        // Try next selector.
      }
    }

    if (!attachmentControlFound) {
      await this.dumpDebugInfo(page);

      throw new Error("Could not find ChatGPT image upload control.");
    }

    await page.waitForTimeout(400);

    fileInputs = page.locator('input[type="file"]');

    if ((await fileInputs.count()) === 0) {
      await this.dumpDebugInfo(page);

      throw new Error("ChatGPT attachment menu opened, but file input was not found.");
    }

    await fileInputs.last().setInputFiles(imagePath);

    await this.waitForAttachment(page, label, baselineAttachmentCount);
  }

  private async waitForAttachment(
    page: Page,
    label: string,
    baselineAttachmentCount: number,
  ): Promise<void> {
    console.log(`[ChatGPT] Waiting for ${label} attachment to finish uploading...`);

    const startedAt = Date.now();
    const deadline = startedAt + 45_000;
    let sawAttachment = false;
    let lastProgressLogAt = 0;

    const uploadBusySelectors = [
      '[aria-busy="true"]',
      '[role="progressbar"]',
      '[data-testid*="upload"][data-state="loading"]',
      '[data-testid*="attachment"][data-state="loading"]',
    ];

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        throw new Error(`ChatGPT page closed while the ${label} was uploading.`);
      }

      const bodyText = await page.locator("body").innerText().catch(() => "");
      const normalized = bodyText.toLowerCase();

      if (
        normalized.includes("failed to upload") ||
        normalized.includes("upload failed") ||
        normalized.includes("couldn't upload") ||
        normalized.includes("could not upload")
      ) {
        throw new Error(`ChatGPT failed to upload the ${label}.`);
      }

      const currentAttachmentCount =
        await this.getVisibleAttachmentEvidenceCount(page);

      const inputHasFile = await page
        .locator('input[type="file"]')
        .evaluateAll((inputs) =>
          inputs.some(
            (input) =>
              ((input as HTMLInputElement).files?.length ?? 0) > 0,
          ),
        )
        .catch(() => false);

      if (
        currentAttachmentCount > baselineAttachmentCount ||
        inputHasFile
      ) {
        sawAttachment = true;
      }

      let busy = false;
      for (const selector of uploadBusySelectors) {
        const locator = page.locator(selector);
        const count = await locator.count().catch(() => 0);

        if (count > 0) {
          for (let i = Math.max(0, count - 3); i < count; i++) {
            if (await locator.nth(i).isVisible().catch(() => false)) {
              busy = true;
              break;
            }
          }
        }

        if (busy) break;
      }

      const hasUploadingText =
        normalized.includes("uploading") ||
        normalized.includes("processing upload") ||
        normalized.includes("جارٍ التحميل") ||
        normalized.includes("جاري التحميل");

      if (sawAttachment && !busy && !hasUploadingText) {
        await page.waitForTimeout(700);
        console.log(`[ChatGPT] ${label} attachment is ready.`);
        return;
      }

      /*
       * ChatGPT can consume/reset the native file input before exposing a
       * stable attachment marker. Because setInputFiles() already succeeded, a
       * stable composer with no upload text is a safe fallback after a short
       * settle window. This is especially important for additional references,
       * where an existing source attachment must not be mistaken for the new one.
       */
      if (Date.now() - startedAt >= 4_000 && !hasUploadingText) {
        const composer = await this.findComposer(page);

        if (composer && (await composer.isVisible().catch(() => false))) {
          console.log(
            `[ChatGPT] ${label} accepted via stable composer fallback.`,
          );
          return;
        }
      }

      if (Date.now() - lastProgressLogAt >= 5_000) {
        lastProgressLogAt = Date.now();
        console.log(
          `[ChatGPT] Attachment still settling... attachment=${sawAttachment} busy=${busy} uploadingText=${hasUploadingText}`,
        );
      }

      await page.waitForTimeout(500);
    }

    // Some ChatGPT layouts expose no stable attachment marker. A long wait is
    // safer than the previous fixed 2.5s delay, especially in packaged builds.
    console.warn(
      "[ChatGPT] Attachment readiness marker was not detected before timeout; continuing after 45s settle window.",
    );
  }

  // ---------------------------------------------------------------------------
  // Architectural Prompt
  // ---------------------------------------------------------------------------

  private buildEditRequest(input: PromptGenerationInput) {
    const preserveModeText = input.preservePresetPrompt.trim();
    const unrestricted = input.preserveMode === "NO_RESTRICTION";

    const preserveEverythingText = unrestricted
      ? ""
      : input.preserveEverythingElse
        ? `
PRESERVE EVERYTHING ELSE:
Yes. Keep all unrelated parts of the image unchanged unless the user explicitly asks otherwise.
`
        : `
PRESERVE EVERYTHING ELSE:
No. You may make supporting adjustments only if they are necessary to fulfill the request, but do not introduce unrelated changes.
`;

    const preservationRules = unrestricted
      ? `
- Follow the user's requested transformation directly.
- Do not add preservation constraints beyond the selected No Restriction preset.
- Broad edits, replacements, restyling, recomposition, and structural changes are allowed when they support the request.
`
      : `
- Preserve the original composition, framing, subject identity, proportions, and visual structure unless the user explicitly asks to change them.
- Do not add unnecessary stylistic changes.
- Do not rewrite the image concept. Edit the existing image.
`;

    const referenceCount = input.referenceImages?.length ?? 0;
    const imageRoleText =
      referenceCount > 0
        ? `
ATTACHED IMAGE ROLES:
- The FIRST attached image is the SOURCE IMAGE that the downstream image model will edit.
- The next ${referenceCount} attached image${referenceCount === 1 ? " is" : "s are"} VISUAL REFERENCE IMAGE${referenceCount === 1 ? "" : "S"} only.
- Analyze the reference image${referenceCount === 1 ? "" : "s"} silently and use only the relevant visual characteristics to improve the final text prompt.
- Do NOT treat a reference image as the main image to edit.
- Do NOT copy unrelated content from a reference image into the source.
- Do NOT describe your image analysis to the user. Convert what matters directly into the final edit prompt.
`
        : "";

    return `
TEXT-ONLY PROMPT-WRITER MODE.
DO NOT generate, edit, transform, or return an image.
DO NOT invoke any image-generation or image-editing tool, even though images are attached.
The attached images are INPUTS TO ANALYZE ONLY. A downstream image generation tool will perform the actual image edit later.

You are writing the final image-editing prompt that will be sent to the selected downstream image generator.

Your job is to inspect the uploaded source image${referenceCount > 0 ? " and visual references" : ""}, reason silently about them, and convert the user's request into one clean, precise TEXT prompt.

IMPORTANT RULES:
- Respect the actual content of the source image.
- Do NOT assume the image is architectural unless it is clearly an architectural render or the user asks for architectural changes.
- If the image is a logo, graphic, poster, product shot, portrait, illustration, or any non-architectural image, treat it accordingly.
- Do NOT invent buildings, rooms, landscapes, or architectural features unless they already exist in the image or the user explicitly requests them.
- If the user asks for a simple change (for example: change a color), then the output prompt must focus only on that change.
${preservationRules}

OUTPUT REQUIREMENTS:
- TEXT ONLY. Never return an image or visual result.
- Return exactly one final prompt as plain text.
- Do not include explanations, analysis, commentary, headings, bullet labels, or preambles.
- Do not include labels like "USER REQUEST", "ANALYSIS", "FINAL PROMPT", or "PROMPT".
- Do not say what you observed in the images separately; incorporate only relevant observations into the edit instruction.
- Write the prompt as a direct instruction for image editing.

EDIT PRESET:
${preserveModeText}

${preserveEverythingText}

${imageRoleText}
YOUR TASK:
Write a concise but strong final edit prompt for the uploaded image based on this user request:

"${input.instruction}"

The final prompt should:
- clearly state what must change
${unrestricted ? "- avoid adding preservation requirements the user did not ask for" : "- clearly state what must stay unchanged"}
- match the true type of the source image
- avoid hallucinating new content
- be suitable for a downstream image generation/editing model

FINAL REMINDER: reply with the prompt TEXT ONLY. Do not create or edit an image yourself.
`.trim();
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  private async submitPrompt(page: Page, composer: Locator, prompt: string): Promise<void> {
    console.log("[ChatGPT] Entering prompt...");

    const userMessages = page.locator('[data-message-author-role="user"]');
    const initialUserCount = await userMessages.count().catch(() => 0);

    await composer.click({ force: true });
    await composer.fill(prompt);

    const sendSelectors = [
      '[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="إرسال"]',
      'button[type="submit"]',
    ];

    const deadline = Date.now() + 35_000;
    let selectedSendButton: Locator | null = null;

    while (Date.now() < deadline && !selectedSendButton) {
      for (const selector of sendSelectors) {
        const locator = page.locator(selector);
        const count = await locator.count().catch(() => 0);

        for (let index = count - 1; index >= 0; index--) {
          const candidate = locator.nth(index);
          const visible = await candidate.isVisible().catch(() => false);
          const disabled = await candidate.isDisabled().catch(() => true);

          if (visible && !disabled) {
            selectedSendButton = candidate;
            break;
          }
        }

        if (selectedSendButton) break;
      }

      if (!selectedSendButton) {
        await page.waitForTimeout(500);
      }
    }

    if (selectedSendButton) {
      await selectedSendButton.click({ force: true, timeout: 5000 });
      console.log("[ChatGPT] Send button clicked. Verifying submission...");
    } else {
      console.warn("[ChatGPT] Send button never became enabled. Trying Enter fallback.");
      await composer.press("Enter");
    }

    const verifyDeadline = Date.now() + 12_000;

    while (Date.now() < verifyDeadline) {
      const currentUserCount = await userMessages.count().catch(() => 0);
      const composerText = (await composer.innerText().catch(() => "")).trim();

      if (currentUserCount > initialUserCount || composerText.length === 0) {
        console.log("[ChatGPT] Prompt submission confirmed.");
        return;
      }

      await page.waitForTimeout(400);
    }

    console.warn("[ChatGPT] First submit attempt was not confirmed. Retrying with Enter...");
    await composer.press("Enter").catch(() => undefined);

    const retryDeadline = Date.now() + 8_000;
    while (Date.now() < retryDeadline) {
      const currentUserCount = await userMessages.count().catch(() => 0);
      const composerText = (await composer.innerText().catch(() => "")).trim();

      if (currentUserCount > initialUserCount || composerText.length === 0) {
        console.log("[ChatGPT] Prompt submission confirmed after retry.");
        return;
      }

      await page.waitForTimeout(400);
    }

    await this.dumpDebugInfo(page).catch(() => undefined);
    throw new Error("ChatGPT prompt could not be submitted after the image upload finished.");
  }

  // ---------------------------------------------------------------------------
  // Assistant Response
  // ---------------------------------------------------------------------------

  private async readConversationApiAssistant(page: Page): Promise<string> {
    const match = page.url().match(/\/c\/([^/?#]+)/);

    if (!match?.[1]) {
      return "";
    }

    const conversationId = match[1];

    return page
      .evaluate(async (id) => {
        try {
          const response = await fetch(`/backend-api/conversation/${id}`, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          });

          if (!response.ok) {
            return "";
          }

          const data = await response.json();
          const mapping = data?.mapping && typeof data.mapping === "object" ? Object.values(data.mapping) : [];

          const assistantMessages = mapping
            .map((node: any) => node?.message)
            .filter((message: any) => message?.author?.role === "assistant")
            .sort((a: any, b: any) => Number(a?.create_time ?? 0) - Number(b?.create_time ?? 0));

          const last = assistantMessages.at(-1);
          const parts = Array.isArray(last?.content?.parts) ? last.content.parts : [];

          return parts
            .filter((part: unknown) => typeof part === "string")
            .join("\n")
            .trim();
        } catch {
          return "";
        }
      }, conversationId)
      .catch(() => "");
  }

  private async waitForAssistantResponse(
    page: Page,
    initialAssistantCount: number,
    initialAssistantText: string,
    initialTurnCount: number,
    timeoutMs = 90_000,
  ): Promise<string> {
    console.log("[ChatGPT] Waiting for prompt result...");

    /*
     * ChatGPT has changed its conversation DOM more than once.
     * Do not rely on data-message-author-role alone. The current UI can render
     * conversation turns without that attribute, which made production wait
     * forever even though the response was already visible.
     */
    const assistantMessages = page.locator(
      [
        '[data-message-author-role="assistant"]',
        '[data-turn="assistant"]',
        'article[data-turn="assistant"]',
      ].join(","),
    );

    const conversationTurns = page.locator('article[data-testid^="conversation-turn-"]');
    const fallbackConversationTurns = page.locator('[data-testid^="conversation-turn-"]');

    const deadline = Date.now() + timeoutMs;
    let previousCandidate = "";
    let stableIterations = 0;
    let lastProgressLogAt = 0;
    let lastApiProbeAt = 0;
    let visualOutputFirstSeenAt: number | null = null;

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        throw new Error("ChatGPT page closed while waiting for the refined prompt.");
      }

      const count = await assistantMessages.count().catch(() => 0);
      let text = "";
      let source = "none";

      if (count > 0) {
        const lastMessage = assistantMessages.last();
        const markdown = lastMessage.locator(".markdown");

        if ((await markdown.count().catch(() => 0)) > 0) {
          text = (await markdown.last().innerText().catch(() => "")).trim();
        } else {
          text = (await lastMessage.innerText().catch(() => "")).trim();
        }

        if (text) {
          source = "assistant-role";
        }
      }

      let turnCount = await conversationTurns.count().catch(() => 0);
      let turns = conversationTurns;

      if (turnCount === 0) {
        turns = fallbackConversationTurns;
        turnCount = await turns.count().catch(() => 0);
      }

      /*
       * A successful submit adds a user turn first and then an assistant turn.
       * If there are at least two new turns, the newest turn is the assistant
       * response even when ChatGPT no longer exposes data-message-author-role.
       */
      let latestAssistantTurnHasVisualOutput = false;

      if (turnCount >= initialTurnCount + 2) {
        const candidate = turns.last();
        const candidateText = (await candidate.innerText().catch(() => "")).trim();
        const imageCount = await candidate.locator("img").count().catch(() => 0);

        latestAssistantTurnHasVisualOutput = imageCount > 0;

        if (!text && candidateText.length > 30) {
          text = candidateText;
          source = "conversation-turn";
        }
      }

      /*
       * Final fallback: read the authenticated conversation JSON. This avoids
       * DOM-selector drift entirely when the server has already stored the
       * assistant response. Probe only every few seconds.
       */
      if (!text && Date.now() - lastApiProbeAt >= 5_000) {
        lastApiProbeAt = Date.now();
        const apiText = await this.readConversationApiAssistant(page);

        if (apiText.length > 30 && apiText !== initialAssistantText) {
          text = apiText;
          source = "conversation-api";
        }
      }

      const stopButton = page.locator(
        [
          '[data-testid="stop-button"]',
          'button[aria-label*="Stop" i]',
          'button[aria-label*="إيقاف"]',
        ].join(","),
      );

      const generating =
        (await stopButton.count().catch(() => 0)) > 0 &&
        (await stopButton.last().isVisible().catch(() => false));

      if (latestAssistantTurnHasVisualOutput) {
        visualOutputFirstSeenAt ??= Date.now();

        // Give ChatGPT a brief chance to finish a tool card. Once generation
        // has stopped and the newest assistant turn still contains an image,
        // treat it as the wrong response type and recover with a text-only turn.
        if (!generating && Date.now() - visualOutputFirstSeenAt >= 2_000) {
          console.warn("[ChatGPT] Visual output detected instead of text prompt.");
          throw new ChatGPTUnexpectedVisualOutputError();
        }
      } else {
        visualOutputFirstSeenAt = null;
      }

      const isNewResponse =
        text.length > 30 &&
        (count > initialAssistantCount || text !== initialAssistantText);

      if (isNewResponse && !latestAssistantTurnHasVisualOutput) {
        if (text === previousCandidate) {
          stableIterations += 1;
        } else {
          previousCandidate = text;
          stableIterations = 0;
          console.log(`[ChatGPT] Response candidate detected via ${source}.`);
        }

        if (stableIterations >= 2 && !generating) {
          console.log(`[ChatGPT] Prompt result received via ${source}.`);
          return text;
        }
      }

      const bodyText = await page.locator("body").innerText().catch(() => "");
      const normalized = bodyText.toLowerCase();

      if (
        normalized.includes("something went wrong") ||
        normalized.includes("there was an error generating a response") ||
        normalized.includes("error in message stream") ||
        normalized.includes("network error") ||
        normalized.includes("حدث خطأ")
      ) {
        throw new Error("ChatGPT returned an error while refining the prompt.");
      }

      if (Date.now() - lastProgressLogAt >= 10_000) {
        lastProgressLogAt = Date.now();
        console.log(
          `[ChatGPT] Still waiting for response... assistantCount=${count} initial=${initialAssistantCount} turnCount=${turnCount} initialTurns=${initialTurnCount} textLength=${text.length}`,
        );
      }

      await page.waitForTimeout(1000);
    }

    await this.dumpDebugInfo(page).catch(() => undefined);
    throw new Error(
      `ChatGPT prompt generation timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
    );
  }

  private cleanResponse(text: string): string {
    return text
      .replace(/^```(?:text|markdown)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .replace(/^\s*(?:final\s+prompt|prompt)\s*:\s*/i, "")
      .trim();
  }

  // ---------------------------------------------------------------------------
  // Generate
  // ---------------------------------------------------------------------------

  async generate(input: PromptGenerationInput): Promise<string> {
    let page: Page | null = null;
    let abortHandler: (() => void) | null = null;

    this.activeJobCount += 1;

    try {
      if (input.signal?.aborted) {
        throw new Error("Generation canceled.");
      }

      console.log(`[ChatGPT] Starting independent prompt generation. Active jobs: ${this.activeJobCount}`);

      await input.onProgress?.({
        stage: "CHATGPT_STARTING",
        message: "Preparing ChatGPT...",
      });

      /*
       * Every generation owns a separate page. The BrowserContext is shared
       * only so every page can reuse the same authenticated Chrome profile.
       */
      page = await this.createJobPage();

      if (input.signal) {
        abortHandler = () => {
          if (page && !page.isClosed()) {
            void page.close().catch(() => undefined);
          }
        };

        input.signal.addEventListener("abort", abortHandler, { once: true });

        if (input.signal.aborted) {
          abortHandler();
          throw new Error("Generation canceled.");
        }
      }

      await this.ensureLoggedIn(page);
      await this.rememberAuthentication(page.context());

      await input.onProgress?.({
        stage: "CHATGPT_UPLOADING_IMAGE",
        message: "Uploading source image to ChatGPT...",
      });

      await this.uploadImage(page, input.sourceImagePath, "source image");

      const referenceImages = input.referenceImages ?? [];

      for (let index = 0; index < referenceImages.length; index += 1) {
        const referenceImage = referenceImages[index];

        if (!referenceImage) {
          continue;
        }

        await input.onProgress?.({
          stage: "CHATGPT_UPLOADING_IMAGE",
          message: `Uploading reference image ${index + 1} of ${referenceImages.length} to ChatGPT...`,
        });

        await this.uploadImage(
          page,
          referenceImage.path,
          `reference image ${index + 1}/${referenceImages.length}`,
        );
      }

      const composer = await this.findComposer(page);

      if (!composer) {
        throw new Error("ChatGPT composer disappeared after attaching the source image.");
      }

      const assistantMessages = page.locator('[data-message-author-role="assistant"]');
      const initialAssistantCount = await assistantMessages.count();
      const initialAssistantText =
        initialAssistantCount > 0
          ? (await assistantMessages.last().innerText().catch(() => "")).trim()
          : "";

      let conversationTurns = page.locator('article[data-testid^="conversation-turn-"]');
      let initialTurnCount = await conversationTurns.count().catch(() => 0);

      if (initialTurnCount === 0) {
        conversationTurns = page.locator('[data-testid^="conversation-turn-"]');
        initialTurnCount = await conversationTurns.count().catch(() => 0);
      }

      console.log(
        `[ChatGPT] Response baseline: assistantCount=${initialAssistantCount} turnCount=${initialTurnCount}`,
      );

      const request = this.buildEditRequest(input);

      await this.submitPrompt(page, composer, request);

      await input.onProgress?.({
        stage: "CHATGPT_WAITING_RESPONSE",
        message: "ChatGPT is analyzing the render and building the prompt...",
      });

      const responseTimeoutMs = referenceImages.length > 0 ? 210_000 : 90_000;

      let response: string;

      try {
        response = await this.waitForAssistantResponse(
          page,
          initialAssistantCount,
          initialAssistantText,
          initialTurnCount,
          responseTimeoutMs,
        );
      } catch (error) {
        if (!(error instanceof ChatGPTUnexpectedVisualOutputError)) {
          throw error;
        }

        console.warn(
          "[ChatGPT] Recovering from unexpected visual response with a text-only follow-up.",
        );

        await input.onProgress?.({
          stage: "CHATGPT_WAITING_RESPONSE",
          message: "ChatGPT returned a visual result. Requesting the text prompt only...",
        });

        const recoveryComposer = await this.findComposer(page);
        if (!recoveryComposer) {
          throw new Error("ChatGPT returned an image instead of a prompt, and the composer could not be found for recovery.");
        }

        const recoveryAssistantMessages = page.locator('[data-message-author-role="assistant"]');
        const recoveryAssistantCount = await recoveryAssistantMessages.count().catch(() => 0);
        const recoveryAssistantText =
          recoveryAssistantCount > 0
            ? (await recoveryAssistantMessages.last().innerText().catch(() => "")).trim()
            : "";

        let recoveryTurns = page.locator('article[data-testid^="conversation-turn-"]');
        let recoveryTurnCount = await recoveryTurns.count().catch(() => 0);
        if (recoveryTurnCount === 0) {
          recoveryTurns = page.locator('[data-testid^="conversation-turn-"]');
          recoveryTurnCount = await recoveryTurns.count().catch(() => 0);
        }

        await this.submitPrompt(
          page,
          recoveryComposer,
          [
            "TEXT ONLY. Do not generate or edit an image.",
            "Your previous response was a visual result, but I need only the final image-editing prompt for another model.",
            "Using the same source image, reference images, user request, and preservation rules from the previous turn, return exactly one plain-text edit prompt.",
            "No explanation, no analysis, no heading, no label, and no image output.",
          ].join(" "),
        );

        response = await this.waitForAssistantResponse(
          page,
          recoveryAssistantCount,
          recoveryAssistantText,
          recoveryTurnCount,
          120_000,
        );
      }

      const cleaned = this.cleanResponse(response);

      if (!cleaned) {
        throw new Error("ChatGPT returned an empty prompt.");
      }

      return cleaned;
    } finally {
      if (input.signal && abortHandler) {
        input.signal.removeEventListener("abort", abortHandler);
      }

      if (page && !page.isClosed()) {
        await page.close().catch(() => undefined);
      }

      this.activeJobCount = Math.max(0, this.activeJobCount - 1);

      console.log(`[ChatGPT] Independent prompt generation finished. Active jobs: ${this.activeJobCount}`);
    }
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    let page: Page | null = null;
    let abortHandler: (() => void) | null = null;
    let imageResponseListener: ((response: Response) => void) | null = null;
    this.activeJobCount += 1;

    const capturedNetworkImages: Array<{ buffer: Buffer; mimeType: string; url: string }> = [];

    try {
      if (input.signal?.aborted) throw new Error("Generation canceled.");
      await mkdir(input.outputDirectory, { recursive: true });
      page = await this.createJobPage();

      if (input.signal) {
        abortHandler = () => {
          if (page && !page.isClosed()) void page.close().catch(() => undefined);
        };
        input.signal.addEventListener("abort", abortHandler, { once: true });
      }

      await this.ensureLoggedIn(page);
      await this.rememberAuthentication(page.context());
      await this.uploadImage(page, input.sourceImagePath, "source image");

      for (let index = 0; index < (input.referenceImagePaths ?? []).length; index += 1) {
        await this.uploadImage(page, input.referenceImagePaths![index]!, `reference image ${index + 1}`);
      }

      const composer = await this.findComposer(page);
      if (!composer) throw new Error("ChatGPT composer disappeared after attaching images.");

      /*
       * Snapshot every image already on the page after all attachments have
       * settled. ChatGPT's generated-image markup changes frequently and is no
       * longer guaranteed to live inside [data-message-author-role=assistant].
       * Anything new, large and visible after submit is therefore a much more
       * reliable signal than the old assistant-message selector.
       */
      const baselineImageKeys = new Set(
        await page
          .locator("img")
          .evaluateAll((images) =>
            images
              .map((element) => {
                const image = element as HTMLImageElement;
                return image.currentSrc || image.src || "";
              })
              .filter(Boolean),
          )
          .catch(() => [] as string[]),
      );

      imageResponseListener = (response: Response) => {
        void (async () => {
          try {
            const headers = response.headers();
            const mimeType = (headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
            if (!mimeType.startsWith("image/")) return;

            const url = response.url();
            if (/favicon|avatar|emoji|icon|logo|profile/i.test(url)) return;

            const buffer = await response.body();
            // Ignore UI assets and tiny thumbnails. The final image is normally
            // orders of magnitude larger than these.
            if (buffer.byteLength < 40_000) return;

            capturedNetworkImages.push({ buffer, mimeType, url });
            capturedNetworkImages.sort((a, b) => b.buffer.byteLength - a.buffer.byteLength);
            if (capturedNetworkImages.length > 8) capturedNetworkImages.length = 8;
          } catch {
            // Some service-worker/cache responses do not expose a readable body.
          }
        })();
      };
      page.on("response", imageResponseListener);

      await this.submitPrompt(
        page,
        composer,
        [
          "IMAGE EDIT MODE. Generate exactly one final edited image.",
          "Use the attached file named source as the only image to edit.",
          "Files named ref 1, ref 2, and so on are references only; never edit or return a reference as the result.",
          "Do not return explanations or a text-only answer. Return the final image.",
          input.prompt,
        ].join("\n\n"),
      );

      type ImageCandidate = {
        locator: Locator;
        key: string;
        naturalWidth: number;
        naturalHeight: number;
        renderedWidth: number;
        renderedHeight: number;
        alt: string;
        inConversationTurn: boolean;
      };

      const findBestGeneratedImage = async (): Promise<ImageCandidate | null> => {
        if (!page || page.isClosed()) return null;

        const images = page.locator("img");
        const count = await images.count().catch(() => 0);
        let best: (ImageCandidate & { score: number }) | null = null;

        for (let index = count - 1; index >= 0; index -= 1) {
          const locator = images.nth(index);
          const info = await locator
            .evaluate((element) => {
              const image = element as HTMLImageElement;
              const rect = image.getBoundingClientRect();
              const style = window.getComputedStyle(image);
              const visible =
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                Number(style.opacity || "1") > 0 &&
                rect.width > 0 &&
                rect.height > 0;

              return {
                key: image.currentSrc || image.src || "",
                naturalWidth: image.naturalWidth || 0,
                naturalHeight: image.naturalHeight || 0,
                renderedWidth: rect.width,
                renderedHeight: rect.height,
                alt: image.alt || "",
                visible,
                inConversationTurn: Boolean(
                  image.closest('[data-message-author-role="assistant"], [data-testid^="conversation-turn-"], article'),
                ),
              };
            })
            .catch(() => null);

          if (!info?.visible || !info.key || baselineImageKeys.has(info.key)) continue;

          const hasUsefulNaturalSize = info.naturalWidth >= 256 && info.naturalHeight >= 256;
          const hasUsefulRenderedSize = info.renderedWidth >= 180 && info.renderedHeight >= 180;
          if (!hasUsefulNaturalSize && !hasUsefulRenderedSize) continue;

          const altLooksGenerated = /generated|image|صورة|تم إنشاؤها/i.test(info.alt);
          const score =
            info.naturalWidth * info.naturalHeight +
            info.renderedWidth * info.renderedHeight * 4 +
            (info.inConversationTurn ? 5_000_000 : 0) +
            (altLooksGenerated ? 10_000_000 : 0);

          if (!best || score > best.score) {
            best = { locator, ...info, score };
          }
        }

        if (!best) return null;
        const { score: _score, ...candidate } = best;
        return candidate;
      };

      const isGenerationBusy = async (): Promise<boolean> => {
        if (!page || page.isClosed()) return false;

        const stopButton = page.locator(
          '[data-testid="stop-button"], button[aria-label*="Stop" i], button[aria-label*="إيقاف" i]',
        );
        const stopVisible =
          (await stopButton.count().catch(() => 0)) > 0 &&
          (await stopButton.last().isVisible().catch(() => false));

        if (stopVisible) return true;

        const lastTurnText = await page
          .locator('[data-testid^="conversation-turn-"], [data-message-author-role="assistant"]')
          .last()
          .innerText()
          .catch(() => "");

        return /creating (?:an )?image|generating (?:an )?image|working on (?:the )?image|إنشاء الصورة|جار.? إنشاء|توليد الصورة/i.test(
          lastTurnText,
        );
      };

      const deadline = Date.now() + 240_000;
      let generatedImage: Locator | null = null;
      let stableCandidateKey = "";
      let stableCandidateSince = 0;
      let firstNetworkCandidateAt = 0;

      while (Date.now() < deadline) {
        if (input.signal?.aborted) throw new Error("Generation canceled.");
        if (page.isClosed()) throw new Error("ChatGPT page closed during image generation.");

        const candidate = await findBestGeneratedImage();
        const busy = await isGenerationBusy();

        if (candidate) {
          if (candidate.key !== stableCandidateKey) {
            stableCandidateKey = candidate.key;
            stableCandidateSince = Date.now();
            console.log("[ChatGPT] Generated image candidate detected:", {
              naturalWidth: candidate.naturalWidth,
              naturalHeight: candidate.naturalHeight,
              renderedWidth: Math.round(candidate.renderedWidth),
              renderedHeight: Math.round(candidate.renderedHeight),
              alt: candidate.alt.slice(0, 80),
            });
          }

          const stableFor = Date.now() - stableCandidateSince;

          // Prefer the explicit completion signal, but do not wait forever for
          // ChatGPT's stop/progress controls. The site can leave those controls
          // mounted after the final image is already complete.
          if ((!busy && stableFor >= 1_500) || stableFor >= 8_000) {
            try {
              await this.waitForRenderableGeneratedImage(candidate.locator);
              generatedImage = candidate.locator;
              break;
            } catch {
              // ChatGPT can mount an <img> before the final bytes are ready.
              // Keep polling instead of accepting a placeholder/broken image.
            }
          }
        } else {
          stableCandidateKey = "";
          stableCandidateSince = 0;
        }

        if (capturedNetworkImages.length > 0 && firstNetworkCandidateAt === 0) {
          firstNetworkCandidateAt = Date.now();
        }

        // Network responses are a fallback for markup variants where the final
        // generated asset is rendered by a component that does not expose an
        // ordinary <img>. Give the DOM a chance first, then accept the largest
        // newly downloaded image once generation no longer looks busy.
        if (
          !candidate &&
          capturedNetworkImages.length > 0 &&
          firstNetworkCandidateAt > 0 &&
          Date.now() - firstNetworkCandidateAt >= 6_000 &&
          !busy
        ) {
          break;
        }

        const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
        if (body.includes("there was an error generating") || body.includes("something went wrong")) {
          throw new Error("ChatGPT returned an error while generating the image.");
        }

        await page.waitForTimeout(750);
      }

      let buffer: Buffer | null = null;
      let mimeType = "image/png";

      if (generatedImage) {
        try {
          await this.waitForRenderableGeneratedImage(generatedImage);

          const captured = await generatedImage.evaluate(async (element) => {
            const image = element as HTMLImageElement;
            const src = image.currentSrc || image.src || "";
            if (!src) throw new Error("Generated image src was empty.");

            if (src.startsWith("data:image/")) {
              const commaIndex = src.indexOf(",");
              if (commaIndex === -1) throw new Error("Generated image data URL is malformed.");

              const meta = src.slice(5, commaIndex);
              const payload = src.slice(commaIndex + 1);
              const detectedMime = meta.split(";")[0] || "image/png";
              const base64 = meta.includes(";base64") ? payload : btoa(decodeURIComponent(payload));
              return { base64, mimeType: detectedMime };
            }

            const response = await fetch(src, { credentials: "include", cache: "no-store" });
            if (!response.ok) throw new Error(`Image download failed (${response.status}).`);

            const responseMime = (response.headers.get("content-type") || "")
              .split(";")[0]
              .trim()
              .toLowerCase();
            if (!responseMime.startsWith("image/")) {
              throw new Error(`Generated asset returned ${responseMime || "non-image content"}.`);
            }

            const bytes = new Uint8Array(await response.arrayBuffer());
            let binary = "";
            const chunk = 0x8000;
            for (let index = 0; index < bytes.length; index += chunk) {
              binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
            }

            return { base64: btoa(binary), mimeType: responseMime };
          });

          const downloaded = Buffer.from(captured.base64, "base64");
          const sniffedMimeType = this.sniffImageMimeType(downloaded);
          if (!sniffedMimeType) {
            throw new Error(`Downloaded bytes are not a supported image format (${captured.mimeType}).`);
          }

          buffer = downloaded;
          mimeType = sniffedMimeType;
        } catch (error) {
          console.warn("[ChatGPT] Direct generated image download failed; using rendered PNG capture:", error);
          buffer = await generatedImage.screenshot({ type: "png" });
          mimeType = "image/png";
        }
      }

      if ((!buffer || buffer.byteLength < 1024 || !this.sniffImageMimeType(buffer)) && capturedNetworkImages.length > 0) {
        const validNetworkImage = capturedNetworkImages.find((candidate) => this.sniffImageMimeType(candidate.buffer));
        if (validNetworkImage) {
          buffer = validNetworkImage.buffer;
          mimeType = this.sniffImageMimeType(validNetworkImage.buffer) ?? validNetworkImage.mimeType ?? "image/png";
          console.log("[ChatGPT] Using captured generated-image network response:", {
            bytes: buffer.byteLength,
            mimeType,
            url: validNetworkImage.url.slice(0, 160),
          });
        }
      }

      const finalMimeType = buffer ? this.sniffImageMimeType(buffer) : null;
      if (!buffer || buffer.byteLength < 1024 || !finalMimeType) {
        throw new Error(
          "ChatGPT finished the request, but Eskander could not capture a valid generated image from the page.",
        );
      }

      mimeType = finalMimeType;
      const extension = this.getImageExtensionFromMimeType(mimeType);
      const fileName = `chatgpt-${randomUUID()}${extension}`;
      const absolutePath = join(input.outputDirectory, fileName);
      await writeFile(absolutePath, buffer);

      return { absolutePath, fileName, mimeType };
    } finally {
      if (page && imageResponseListener) {
        page.off("response", imageResponseListener);
      }
      if (input.signal && abortHandler) input.signal.removeEventListener("abort", abortHandler);
      if (page && !page.isClosed()) await page.close().catch(() => undefined);
      this.activeJobCount = Math.max(0, this.activeJobCount - 1);
    }
  }

  private getImageExtensionFromMimeType(mimeType: string): string {
    const normalized = mimeType.toLowerCase().split(";")[0].trim();
    if (normalized.includes("jpeg") || normalized.includes("jpg")) return ".jpg";
    if (normalized.includes("webp")) return ".webp";
    if (normalized.includes("avif")) return ".avif";
    if (normalized.includes("gif")) return ".gif";
    if (normalized.includes("svg")) return ".svg";
    return ".png";
  }

  private sniffImageMimeType(buffer: Buffer): string | null {
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return "image/png";
    }

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return "image/jpeg";
    }

    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return "image/webp";
    }

    if (buffer.length >= 6) {
      const header = buffer.subarray(0, 6).toString("ascii");
      if (header === "GIF87a" || header === "GIF89a") return "image/gif";
    }

    if (buffer.length >= 12) {
      const boxType = buffer.subarray(4, 12).toString("ascii");
      if (boxType === "ftypavif" || boxType === "ftypavis") return "image/avif";
    }

    const headerText = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8").trimStart().toLowerCase();
    if (headerText.startsWith("<svg") || headerText.startsWith("<?xml") || headerText.includes("<svg")) {
      return "image/svg+xml";
    }

    return null;
  }

  private async waitForRenderableGeneratedImage(image: Locator, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const state = await image
        .evaluate((element) => {
          const img = element as HTMLImageElement;
          return {
            complete: img.complete,
            naturalWidth: img.naturalWidth || 0,
            naturalHeight: img.naturalHeight || 0,
            src: img.currentSrc || img.src || "",
          };
        })
        .catch(() => null);

      if (
        state?.complete &&
        state.naturalWidth >= 128 &&
        state.naturalHeight >= 128 &&
        state.src &&
        !state.src.startsWith("data:image/gif") &&
        !state.src.startsWith("data:image/svg")
      ) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    throw new Error("ChatGPT generated image never became renderable.");
  }

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  private async dumpDebugInfo(page: Page): Promise<void> {
    console.log("========== CHATGPT DEBUG ==========");

    console.log("[ChatGPT] URL:", page.url());

    console.log("[ChatGPT] Title:", await page.title().catch(() => ""));

    const composerCount = await page
      .locator(["#prompt-textarea", '[contenteditable="true"][role="textbox"]', "textarea"].join(","))
      .count()
      .catch(() => 0);

    console.log("[ChatGPT] Composer count:", composerCount);

    const controls = await page
      .locator('input, textarea, [contenteditable="true"], button, a, [role="button"]')
      .evaluateAll((elements) =>
        elements.slice(-120).map((element) => ({
          tag: element.tagName,
          id: element.getAttribute("id"),
          type: element.getAttribute("type"),
          href: element.getAttribute("href"),
          ariaLabel: element.getAttribute("aria-label"),
          dataTestId: element.getAttribute("data-testid"),
          text: element.textContent?.trim().slice(0, 120) ?? "",
        })),
      )
      .catch(() => []);

    console.log("[ChatGPT] Controls:", controls);

    console.log("===================================");
  }
}
