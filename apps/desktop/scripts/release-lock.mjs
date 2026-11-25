// The RELEASE-RUNNING lock: while `pnpm release` runs (not --dry-run), the file
// releases/RELEASE-RUNNING tells other sessions that nothing may merge into main, since a new commit there makes
// the release start over (CLAUDE.md > Versioning). It holds one line: the version and when it started, then who holds
// it ("pid 1234@brain-pc"), so a run whose holder on this PC is gone (a closed window, a crash) takes it over.
//
// No local path lives in the repo: TAVORA_RELEASE_LOCK names the file, or else it is releases/RELEASE-RUNNING in the
// nearest folder above the checkout that has a releases folder (the main checkout's parent, or the parent of a
// worktrees folder for a release from a fresh clone there).
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";

const NAME = "RELEASE-RUNNING";

/** The first path `git worktree list --porcelain` prints: the main checkout, also when asked from a worktree. Null if there is none. */
export function mainCheckoutOf(porcelain) {
  const first = /^worktree (.+)$/m.exec(String(porcelain).replace(/\r\n?/g, "\n"));
  return first ? first[1].trim() : null;
}

/**
 * Where the lock goes for the checkout at `repo`, or null if there is no releases folder up to three levels above the
 * main checkout (`main`, the first path git lists; a worktree lives elsewhere, so it is no place to look from) or,
 * failing that, above `repo`. The caller must not go on without a lock when this is null.
 */
export function lockPath(repo, env = process.env, main = null) {
  if (env.TAVORA_RELEASE_LOCK) return path.resolve(env.TAVORA_RELEASE_LOCK);
  for (const start of [main, repo]) {
    if (!start) continue;
    let dir = path.resolve(start);
    for (let level = 0; level < 3; level++) {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
      const releases = path.join(dir, "releases");
      if (existsSync(releases) && statSync(releases).isDirectory()) return path.join(releases, NAME);
    }
  }
  return null;
}

/** Whether a process with this id runs on this PC (EPERM: it does, as another user). */
function processRuns(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/** Who holds a lock, from its line ("<version> <start> pid <n>@<host>"), or null for a lock that doesn't say. */
export function lockHolder(line) {
  const match = / pid ([1-9]\d*)@(\S+)$/.exec(String(line).trim());
  return match ? { pid: Number(match[1]), host: match[2] } : null;
}

/**
 * Takes the lock for `version`. Returns { release } (call it on exit; it removes the file only while it is still this
 * run's; `replaced` names a lock whose holder had gone), or { problem } when another release holds it. A lock is taken
 * over only when it names a process on this PC that no longer runs: one that runs, one from another PC or one that
 * names no holder stays. `who`: { pid, host, isRunning } (tests pass their own).
 */
export function takeLock(file, version, now = new Date(), who = {}) {
  const pid = who.pid ?? process.pid;
  const host = who.host ?? hostname();
  const isRunning = who.isRunning ?? processRuns;
  const text = `${version} ${now.toISOString()} pid ${pid}@${host}\n`;
  let replaced;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, text, { flag: "wx" });
      return {
        replaced,
        release() {
          try {
            if (readFileSync(file, "utf8") === text) rmSync(file, { force: true });
          } catch {}
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") return { problem: `Can't take the release lock at ${file} (${error.code ?? error.message}). Create its folder, or set TAVORA_RELEASE_LOCK to another path.` };
    }
    let held = "";
    try {
      held = readFileSync(file, "utf8");
    } catch {}
    const holder = lockHolder(held);
    if (attempt === 0 && holder && holder.host === host && !isRunning(holder.pid)) {
      // Its holder is gone. Removed only while it still says the same, so a run that took it meanwhile keeps it.
      try {
        if (readFileSync(file, "utf8") === held) rmSync(file, { force: true });
      } catch {}
      replaced = held.trim();
      continue;
    }
    return {
      problem: `Another release is running (${file}: ${held.trim() || "empty"}). Wait for it; if no release is running, delete that file and try again.`,
    };
  }
  return { problem: `Another release took the lock at ${file} just now. Wait for it.` };
}

/**
 * Ends the script on Ctrl+C, a closed window (SIGHUP; Windows gives it a few seconds), a kill (SIGTERM) and Ctrl+Break:
 * `stop(signal)` first (say, stop the Release build on GitHub), then exit with the signal's code, so the exit handler
 * frees the lock. `on` and `exit` are for tests.
 */
/** The exit code of each (128 plus its number, as Windows and POSIX number them alike). */
const STOP_SIGNALS = { SIGINT: 2, SIGHUP: 1, SIGTERM: 15, SIGBREAK: 21 };

export function stopOnSignals(stop, on = (event, run) => process.on(event, run), exit = (code) => process.exit(code)) {
  for (const [signal, number] of Object.entries(STOP_SIGNALS)) {
    on(signal, () => {
      try {
        stop(signal);
      } finally {
        exit(128 + number);
      }
    });
  }
}

/**
 * Takes the lock for the checkout at `repo` (the release's or the refresh's `label`) and frees it when the process
 * exits, however it exits. Returns { file } or { problem } (no releases folder, or another release holds the lock).
 * `worktrees`: what `git worktree list --porcelain` printed, to find the main checkout. `on` registers the exit
 * handler (tests pass their own); Ctrl+C, a closed window and a kill free it too, as long as the script exits on them (stopOnSignals).
 */
export function holdLock(repo, label, worktrees, env = process.env, on = (event, run) => process.on(event, run)) {
  let main = null;
  try {
    main = mainCheckoutOf(worktrees);
  } catch {}
  const file = lockPath(repo, env, main);
  // No lock means nothing would stop a merge during the release, so this stops instead of going on without one.
  if (!file) {
    return {
      problem: "No releases folder found next to the main checkout or above this one, so there is nowhere to put the RELEASE-RUNNING lock. Create the releases folder, or set TAVORA_RELEASE_LOCK to the lock's path.",
    };
  }
  const lock = takeLock(file, label);
  if (lock.problem) return { problem: lock.problem };
  on("exit", lock.release);
  return lock.replaced ? { file, replaced: lock.replaced } : { file };
}

/**
 * What the lock at `file` says for a session about to merge (hunt 2026-11-25 E9): "free" (no lock), "running" (its
 * holder runs, or it is held from another PC, or it names no holder: wait), or "stale" (it names a process on this PC
 * that is gone, as after a kill that ran no exit handler: nothing is releasing, so merging is fine and the next
 * release takes it over). `who`: { host, isRunning } (tests pass their own).
 */
export function lockStatus(file, who = {}) {
  const host = who.host ?? hostname();
  const isRunning = who.isRunning ?? processRuns;
  let line;
  try {
    line = readFileSync(file, "utf8").trim();
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "free" };
    return { state: "running", line: `(can't read ${file}: ${error?.code ?? error?.message})` };
  }
  const holder = lockHolder(line);
  if (holder && holder.host === host && !isRunning(holder.pid)) return { state: "stale", line };
  return { state: "running", line };
}
