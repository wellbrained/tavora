import { readFileSync } from "node:fs";
import path from "node:path";
import { app, protocol } from "electron";
import { HOST_SCHEME, MODULE_SCHEME } from "./assets";
import { Host } from "./host";

// Both schemes behave like https origins: standard URL parsing, a secure
// context and per-origin storage. Neither may register service workers.
protocol.registerSchemesAsPrivileged([
  { scheme: MODULE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: HOST_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Every renderer is sandboxed, including any created by accident.
app.enableSandbox();

if (process.env.TAVORA_USER_DATA) app.setPath("userData", path.resolve(process.env.TAVORA_USER_DATA));

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
const moduleDirs = process.env.TAVORA_MODULE_DIRS
  ? dirList(process.env.TAVORA_MODULE_DIRS)
  : [app.isPackaged ? path.join(process.resourcesPath, "modules") : path.join(repoRoot, "examples")];
// Official modules (Notes, To-Dos) ship inside a packaged build and are
// loaded from the repo's modules/ folder in a dev run.
const officialModuleDirs = process.env.TAVORA_OFFICIAL_MODULE_DIRS
  ? dirList(process.env.TAVORA_OFFICIAL_MODULE_DIRS)
  : [app.isPackaged ? path.join(process.resourcesPath, "official-modules") : path.join(repoRoot, "modules")];

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
        rendererDir: path.join(__dirname, "../renderer"),
        modulePreload: path.join(__dirname, "../preload/module.cjs"),
        hostPreload: path.join(__dirname, "../preload/host.cjs"),
        icon: path.join(__dirname, "../../assets/icon-256.png"),
        devTools: !app.isPackaged && process.env.TAVORA_DEVTOOLS === "1",
        grayscaleText,
        restart,
        hidden: !app.isPackaged && process.env.TAVORA_HIDDEN === "1",
        devServer,
      });
    })
    .catch((error: unknown) => {
      console.error("[tavora] failed to start", error);
      app.exit(1);
    });
}
