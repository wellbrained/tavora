import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The tests make their temp folders with mkdtemp(tmpdir()) and mostly leave them, which
// filled the drive with tens of thousands of tavora-* folders. A test run instead points
// TEMP/TMP/TMPDIR at a folder of its own, which its workers and every app they start
// inherit, and removes that folder when the run ends. A run that was killed never gets to
// clean up, so each run also removes the folders of runs whose process is gone.

const RUNS = "tavora-test-runs";

/** Gives this test run its own temp folder and returns the cleanup for the end of the run. */
export function useRunTempDir(): () => void {
  const runs = path.join(tmpdir(), RUNS);
  removeAbandonedRuns(runs);
  const dir = path.join(runs, `${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(dir, { recursive: true });
  for (const name of ["TEMP", "TMP", "TMPDIR"]) process.env[name] = dir;
  return () => removeFolder(dir);
}

function removeAbandonedRuns(runs: string): void {
  let entries: string[];
  try {
    entries = readdirSync(runs);
  } catch {
    return;
  }
  for (const entry of entries) {
    const pid = Number(entry.split("-")[0]);
    if (!Number.isInteger(pid) || !isRunning(pid)) removeFolder(path.join(runs, entry));
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// On Windows an app that is still closing can hold a file for a moment; what stays is
// removed by the next run.
function removeFolder(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    // Left for the next run.
  }
}
