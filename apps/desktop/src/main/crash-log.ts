// A short local record of processes that went away unasked: the GPU process, a utility, the host page or a module's
// page. When all of Tavora goes blank and draws every panel again, this tells a GPU crash from a page that crashed.
// It stays on this PC (logs/crashes.log in the data folder, the newest CRASHES_KEPT lines): nothing is sent anywhere,
// and it holds no names, addresses or folders, only what went, why, its exit code and the module's id.
import os from "node:os";
import path from "node:path";
import { appendLogLine } from "./diagnostics";

/** Lines kept: the last few weeks of trouble on a PC that has some. */
export const CRASHES_KEPT = 100;

export interface GoneProcess {
  /** What went: Electron's process type ("GPU", "Utility", ...), "host page" or "module page". */
  type: string;
  /** Electron's reason ("crashed", "oom", "killed", ...). */
  reason: string;
  exitCode: number;
  /** For a module's page, the module's id. */
  moduleId?: string;
}

let file: string | null = null;
let userData = "";

/** Where the log goes: logs/crashes.log in the data folder. Until this is called nothing is written. */
export function useCrashLog(dataFolder: string): void {
  userData = dataFolder;
  file = path.join(dataFolder, "logs", "crashes.log");
}

/** One line of the log. */
export function crashLine(gone: GoneProcess): string {
  const word = (value: string) => value.replace(/[^\w.\- ]/g, "").slice(0, 60) || "?";
  return [`${word(gone.type)} gone: ${word(gone.reason)}`, `exit ${gone.exitCode}`, gone.moduleId ? `module ${word(gone.moduleId)}` : ""].filter(Boolean).join(", ");
}

/** Notes a process that went away; a clean exit is no trouble and is left out. */
export function recordCrash(gone: GoneProcess, now = new Date()): void {
  if (gone.reason === "clean-exit") return;
  console.warn(`[tavora] ${crashLine(gone)}`);
  if (!file) return;
  try {
    appendLogLine(file, crashLine(gone), CRASHES_KEPT, { home: os.homedir(), userData }, now);
  } catch {
    // A full or read-only disk must not turn one crash into another.
  }
}
