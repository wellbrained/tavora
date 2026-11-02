// A bare window for dock-model.spec.ts: it only loads the bundle that runs real dockview next to the model.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { sandbox: true } });
  win.loadFile(path.join(process.env.DOCK_COMPARE_DIR, "page.html"));
});
app.on("window-all-closed", () => app.quit());
