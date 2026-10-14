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

const repoRoot = path.resolve(__dirname, "../../../..");
const moduleDirs = process.env.TAVORA_MODULE_DIRS
  ? process.env.TAVORA_MODULE_DIRS.split(path.delimiter).filter(Boolean)
  : [path.join(repoRoot, "examples")];

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
        rendererDir: path.join(__dirname, "../renderer"),
        modulePreload: path.join(__dirname, "../preload/module.cjs"),
        hostPreload: path.join(__dirname, "../preload/host.cjs"),
        icon: path.join(__dirname, "../../assets/icon-256.png"),
        devTools: !app.isPackaged && process.env.TAVORA_DEVTOOLS === "1",
        devServer,
      });
    })
    .catch((error: unknown) => {
      console.error("[tavora] failed to start", error);
      app.exit(1);
    });
}
