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

function writeLine(line: string, now: Date): void {
  if (!file) return;
  try {
    appendLogLine(file, line, CRASHES_KEPT, { home: os.homedir(), userData }, now);
  } catch {
    // A full or read-only disk must not turn one crash into another.
  }
}

/** Notes a process that went away; a clean exit is no trouble and is left out. */
export function recordCrash(gone: GoneProcess, now = new Date()): void {
  if (gone.reason === "clean-exit") return;
  const line = crashLine(gone);
  console.warn(`[tavora] ${line}`);
  writeLine(line, now);
}

export type MainError = "uncaught error" | "unhandled rejection";
let reporting = false;

/**
 * An error in the main process that nothing caught (from a timer or an event): its message and stack go to the error
 * log (Copy diagnostic info, which leaves out the user's folders), and one line without them to this log. Tavora goes
 * on, as it would after Electron's own box, which never opens: it shows the stack, with the user's folders, and can
 * pop up over a game. An error while reporting one is dropped, so a closed console can't loop.
 */
export function recordMainError(kind: MainError, error: unknown, now = new Date()): void {
  if (reporting) return;
  reporting = true;
  try {
    console.error(`[tavora] ${kind} in the main process:`, error);
  } catch {
    // Nowhere to say it; the line below still goes.
  } finally {
    writeLine(`main process ${kind}`, now);
    reporting = false;
  }
}

/** Sends every uncaught error and unhandled rejection of the main process to recordMainError. */
export function catchMainErrors(target: Pick<NodeJS.Process, "on"> = process): void {
  target.on("uncaughtException", (error) => recordMainError("uncaught error", error));
  target.on("unhandledRejection", (reason) => recordMainError("unhandled rejection", reason));
}
