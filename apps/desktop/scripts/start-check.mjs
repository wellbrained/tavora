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
import { fileURLToPath } from "node:url";

const WINDOW_TITLE = "Tavora";

/** The title of a process's main window, or "" while it has none (Windows only). */
function windowTitle(pid) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowTitle`], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`Window probe failed: ${result.error?.message ?? result.stderr}`);
  return (result.stdout ?? "").trim();
}

/**
 * Resolves to "window" or "handover"; throws with what Tavora printed when it quits or never shows a window.
 * options: { allowHandover = false, timeoutMs = 60_000 }
 */
export async function checkStart(exe, { allowHandover = false, timeoutMs = 60_000 } = {}) {
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
      if (windowTitle(child.pid) === WINDOW_TITLE) return "window";
    }
    const probe = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-Process -Name Tavora -ErrorAction SilentlyContinue | Select-Object Id,SessionId,MainWindowTitle,MainWindowHandle,Responding | ConvertTo-Json -Compress`], { encoding: "utf8" });
    throw new Error(`Tavora.exe (PID ${child.pid}) showed no "${WINDOW_TITLE}" window within ${timeoutMs / 1000} s.\nWindows: ${probe.stdout?.trim()}\nProbe: ${probe.stderr?.trim()}\n${stderr.trim()}`);
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
