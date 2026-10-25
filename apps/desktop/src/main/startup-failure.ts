// When Tavora can't start, the player is told why and a log is left to send: 0.17.3
// closed on every start without a word, and nobody could tell what had happened.
import os from "node:os";
import path from "node:path";
import { dialog } from "electron";
import { appendStartupLog } from "./diagnostics";

/**
 * Writes the startup log and shows a message box. Waits until the player closes it; the caller then quits. `quiet`
 * leaves the box out: a development start in the background only logs, and comes back after the next build.
 */
export function reportStartupFailure(userData: string, message: string, detail?: string, quiet = false): void {
  console.error(`[tavora] ${message}${detail ? `\n${detail}` : ""}`);
  const log = path.join(userData, "logs", "startup.log");
  try {
    appendStartupLog(log, detail ? `${message} ${detail}` : message, { home: os.homedir(), userData });
  } catch {
    // The message box still tells the player; a full or read-only disk shouldn't hide it.
  }
  if (quiet) return;
  dialog.showErrorBox("Tavora could not start", `${message}\n\nIf this keeps happening, send this file to whoever helps you with Tavora:\n${log}`);
}
