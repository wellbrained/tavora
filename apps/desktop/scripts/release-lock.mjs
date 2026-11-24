// The RELEASE-RUNNING lock: while `pnpm release` runs (not --dry-run), the file
// releases/RELEASE-RUNNING tells other sessions that nothing may merge into main, since a new commit there makes
// the release start over (CLAUDE.md > Versioning). It holds one line: the version and when it started.
//
// No local path lives in the repo: TAVORA_RELEASE_LOCK names the file, or else it is releases/RELEASE-RUNNING in the
// nearest folder above the checkout that has a releases folder (the main checkout's parent, or the parent of a
// worktrees folder for a release from a fresh clone there).
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/**
 * Takes the lock for `version`. Returns { release } (call it on exit; it removes the file only while it is still this
 * run's), or { problem } when another release holds it.
 */
export function takeLock(file, version, now = new Date()) {
  const text = `${version} ${now.toISOString()}\n`;
  try {
    writeFileSync(file, text, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") return { problem: `Can't take the release lock at ${file} (${error.code ?? error.message}). Create its folder, or set TAVORA_RELEASE_LOCK to another path.` };
    let held = "";
    try {
      held = readFileSync(file, "utf8").trim();
    } catch {}
    return {
      problem: `Another release is running (${file}: ${held || "empty"}). Wait for it; if no release is running, delete that file and try again.`,
    };
  }
  return {
    release() {
      try {
        if (readFileSync(file, "utf8") === text) rmSync(file, { force: true });
      } catch {}
    },
  };
}

/**
 * Takes the lock for the checkout at `repo` (the release's or the refresh's `label`) and frees it when the process
 * exits, however it exits. Returns { file } or { problem } (no releases folder, or another release holds the lock).
 * `worktrees`: what `git worktree list --porcelain` printed, to find the main checkout. `on` registers the exit
 * handler (tests pass their own); Ctrl+C frees the lock too, as long as the script's SIGINT handler exits.
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
  return { file };
}
