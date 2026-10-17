// Starts a packaged Tavora.exe and passes only once its window is up: e2e runs Tavora
// unpackaged, so code that only runs packaged is never started there (0.17.3 quit on
// every start). Used by CI on the installed app and by `pnpm release` on the build.
//
//   node scripts/start-check.mjs <Tavora.exe> [--allow-handover]
//
// --allow-handover: a quick exit 0 passes too. Next to a running Tavora (Nik's `pnpm dev`
// shares the data folder) a second one hands over to it and quits; the start gates ran
// before that, the window did not.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tavora's window: a Chromium one titled "Tavora", shown only once its page has painted (show: false
 * until ready-to-show). The "could not start" message box is a #32770 dialog and never counts, nor
 * does the untitled Chromium window Tavora also shows. .NET's MainWindowTitle picked that untitled
 * one on CI, so every window is listed (windows.ps1).
 */
const APP_WINDOW_CLASS = "Chrome_WidgetWin_1";
const APP_WINDOW_TITLE = "Tavora";

/** The visible top-level windows of every process with this exe's name: [{ pid, cls, title }] (Windows only). */
function visibleWindows(exe) {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "windows.ps1");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Name", path.basename(exe, ".exe")], { encoding: "utf8" });
  // A broken probe must fail loudly, not look like "no window yet".
  if (result.error || result.status !== 0) throw new Error(`Window probe failed: ${result.error?.message ?? result.stderr}`);
  return (result.stdout ?? "").split(/\r?\n/).filter(Boolean).map((line) => {
    const [pid, cls, title = ""] = line.split("\t");
    return { pid: Number(pid), cls, title };
  });
}

const describeWindows = (windows) => windows.map((w) => `pid ${w.pid}: ${w.cls} "${w.title}"`).join("\n") || "no visible Tavora window";

/** Saves the whole screen as a PNG (Windows only). */
function screenshot(file) {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
    "$b = [System.Windows.Forms.SystemInformation]::VirtualScreen",
    "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
    "[System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Left, $b.Top, 0, 0, $b.Size)",
    `$bmp.Save('${file.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
  ].join("; ");
  spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "inherit" });
}

/**
 * Resolves to "window" or "handover"; throws with what Tavora printed when it quits or never shows a window.
 * options: { allowHandover = false, timeoutMs = 120_000 }
 */
export async function checkStart(exe, { allowHandover = false, timeoutMs = 120_000 } = {}) {
  const child = spawn(exe, [], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  let exit = null;
  child.on("exit", (code) => (exit = code ?? 1));
  child.on("error", (error) => (exit = error));
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (exit instanceof Error) throw exit;
      if (exit !== null) {
        if (exit === 0 && allowHandover) return "handover";
        throw new Error(`Tavora.exe quit with exit code ${exit} before showing its window.\n${stderr.trim()}`);
      }
      const windows = visibleWindows(exe);
      if (windows.some((w) => w.cls === APP_WINDOW_CLASS && w.title === APP_WINDOW_TITLE)) {
        console.log(`Window up after ${Math.round((Date.now() - deadline + timeoutMs) / 1000)} s:\n${describeWindows(windows)}`);
        return "window";
      }
    }
    // CI sets START_CHECK_SCREENSHOT and uploads the file: what the screen shows while Tavora still runs.
    if (process.env.START_CHECK_SCREENSHOT) screenshot(process.env.START_CHECK_SCREENSHOT);
    throw new Error(`Tavora.exe showed no window within ${timeoutMs / 1000} s.\n${describeWindows(visibleWindows(exe))}\n${stderr.trim()}`);
  } finally {
    if (exit === null) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const exe = process.argv[2];
  if (!exe) {
    console.error("Usage: node scripts/start-check.mjs <Tavora.exe> [--allow-handover]");
    process.exit(2);
  }
  try {
    const how = await checkStart(exe, { allowHandover: process.argv.includes("--allow-handover") });
    console.log(how === "window" ? "Tavora started and showed its window." : "Tavora handed over to one that is already running.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
