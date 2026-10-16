import { readFileSync } from "node:fs";
import path from "node:path";
import { app, protocol } from "electron";
import { HOST_SCHEME, MODULE_SCHEME } from "./assets";
import { errorLog } from "./diagnostics";
import { Host } from "./host";
import { parseTestHosts } from "./network";

// The last errors of this run, for Settings > Copy diagnostic info.
errorLog.capture();

// Both schemes behave like https origins: standard URL parsing, a secure
// context and per-origin storage. Neither may register service workers.
protocol.registerSchemesAsPrivileged([
  { scheme: MODULE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: HOST_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Every renderer is sandboxed, including any created by accident.
app.enableSandbox();

// The data folder is fixed, not derived from the app's name: it has always been
// %APPDATA%\@tavora\desktop (the package name), and the installed app is named
// Tavora, which would otherwise move everyone's games and settings.
// Like every switch below, only a development run honours the environment: whoever can set it for a packaged Tavora
// could otherwise point it at their own data folder or modules, or have a module listed as Official.
if (!app.isPackaged && process.env.TAVORA_USER_DATA) app.setPath("userData", path.resolve(process.env.TAVORA_USER_DATA));
else app.setPath("userData", path.join(app.getPath("appData"), "@tavora", "desktop"));

// OLED panels don't use the RGB subpixel layout ClearType assumes, so small
// text gets colour fringes there. Chromium only takes this switch before the
// app is ready, so the setting is read straight from library.json and a
// change applies on the next start.
const grayscaleText = readGrayscaleText();
if (grayscaleText) app.commandLine.appendSwitch("disable-lcd-text");

function readGrayscaleText(): boolean {
  try {
    const saved: unknown = JSON.parse(readFileSync(path.join(app.getPath("userData"), "library.json"), "utf8"));
    return (saved as { grayscaleText?: unknown } | null)?.grayscaleText === true;
  } catch {
    return false;
  }
}

// Last line of defence for any webContents the host did not configure itself.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

// `pnpm dev` serves the host UI with hot reload and restarts Tavora when
// main code changes. Packaged builds always use the built files.
const devServer = !app.isPackaged ? process.env.TAVORA_DEV_SERVER : undefined;
// The dev script asks Tavora to quit before restarting it; quit properly so
// unsaved layouts and window bounds are written first.
if (devServer) {
  process.on("message", (message) => message === "quit" && app.quit());
  process.on("SIGTERM", () => app.quit());
}

// Quitting saves layouts and window bounds first (see window-all-closed).
// Under `pnpm dev` the dev script restarts Tavora, so it keeps hot reload.
// A portable build relaunches its own .exe, not the copy it unpacked.
function restart(): void {
  if (devServer && process.send) {
    process.send("restart");
    return;
  }
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  app.relaunch(portable ? { execPath: portable } : undefined);
  app.quit();
}

const repoRoot = path.resolve(__dirname, "../../../..");
const dirList = (value: string) => value.split(path.delimiter).filter(Boolean);
const moduleDirs = !app.isPackaged && process.env.TAVORA_MODULE_DIRS
  ? dirList(process.env.TAVORA_MODULE_DIRS)
  : [app.isPackaged ? path.join(process.resourcesPath, "modules") : path.join(repoRoot, "examples")];
// Official modules (Notes, To-Dos) ship inside a packaged build and are
// loaded from the repo's modules/ folder in a dev run.
const officialModuleDirs = !app.isPackaged && process.env.TAVORA_OFFICIAL_MODULE_DIRS
  ? dirList(process.env.TAVORA_OFFICIAL_MODULE_DIRS)
  : [app.isPackaged ? path.join(process.resourcesPath, "official-modules") : path.join(repoRoot, "modules")];

// Themes work the same way: Tavora's own ship inside the app, and the
// player's own live in the themes folder of their data folder.
const officialThemeDirs = !app.isPackaged && process.env.TAVORA_OFFICIAL_THEME_DIRS
  ? dirList(process.env.TAVORA_OFFICIAL_THEME_DIRS)
  : [app.isPackaged ? path.join(process.resourcesPath, "official-themes") : path.join(repoRoot, "themes")];
const themeDirs = !app.isPackaged && process.env.TAVORA_THEME_DIRS ? dirList(process.env.TAVORA_THEME_DIRS) : [];

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let host: Host | undefined;

  app.on("second-instance", () => {
    if (host?.window.isMinimized()) host.window.restore();
    host?.window.focus();
  });

  app.on("window-all-closed", () => {
    void (host?.flush() ?? Promise.resolve()).finally(() => app.quit());
  });

  app
    .whenReady()
    .then(async () => {
      host = await Host.create({
        userData: app.getPath("userData"),
        moduleDirs,
        officialModuleDirs,
        officialThemeDirs,
        themeDirs,
        rendererDir: path.join(__dirname, "../renderer"),
        modulePreload: path.join(__dirname, "../preload/module.cjs"),
        hostPreload: path.join(__dirname, "../preload/host.cjs"),
        icon: path.join(__dirname, "../../assets/icon-256.png"),
        devTools: !app.isPackaged && process.env.TAVORA_DEVTOOLS === "1",
        grayscaleText,
        restart,
        hidden: !app.isPackaged && process.env.TAVORA_HIDDEN === "1",
        moduleStorageLimit: !app.isPackaged && process.env.TAVORA_MODULE_STORAGE_LIMIT_MB ? Number(process.env.TAVORA_MODULE_STORAGE_LIMIT_MB) * 1024 * 1024 : undefined,
        // Tests only: network.fetch reaches these names on a local server over plain http; a packaged app never does.
        testNetworkHosts: !app.isPackaged && process.env.TAVORA_TEST_NETWORK_HOSTS ? parseTestHosts(process.env.TAVORA_TEST_NETWORK_HOSTS) : undefined,
        // Tests only: Claude's usage is asked from a local server; a packaged app always asks Anthropic.
        aiUsageUrl: !app.isPackaged && /^http:\/\/127\.0\.0\.1:\d+\//.test(process.env.TAVORA_TEST_AI_USAGE_URL ?? "") ? process.env.TAVORA_TEST_AI_USAGE_URL : undefined,
        systemLocale: !app.isPackaged ? process.env.TAVORA_LOCALE : undefined,
        systemTheme: !app.isPackaged && (process.env.TAVORA_SYSTEM_THEME === "dark" || process.env.TAVORA_SYSTEM_THEME === "light") ? process.env.TAVORA_SYSTEM_THEME : undefined,
        devServer,
        // A packaged app only ever talks to api.mytavora.app.
        apiUrl: !app.isPackaged ? process.env.TAVORA_API_URL : undefined,
        // Accounts are on for everyone since 0.16.4 (wellbrained, 2026-10-16: testers try them in the installed app).
        accounts: true,
        // Development only: another account service, such as a local apps/api with TAVORA_TEST_INBOX_PORT (its codes show on that inbox page).
        accountUrl: !app.isPackaged ? process.env.TAVORA_ACCOUNT_URL : undefined,
        // Likewise, a packaged app only ever uses Steam's own icon address.
        steamIcons: !app.isPackaged ? process.env.TAVORA_STEAM_ICONS_URL : undefined,
        // And only ever the real Discord app and discord.com.
        discord:
          !app.isPackaged && process.env.TAVORA_DISCORD_IPC && process.env.TAVORA_DISCORD_TOKEN_URL
            ? { ipcPath: process.env.TAVORA_DISCORD_IPC, tokenUrl: process.env.TAVORA_DISCORD_TOKEN_URL }
            : undefined,
      });
    })
    .catch((error: unknown) => {
      console.error("[tavora] failed to start", error);
      app.exit(1);
    });
}
