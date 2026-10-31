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

/** Where the lock goes for the checkout at `repo`, or null if there is no releases folder up to three levels up. */
export function lockPath(repo, env = process.env) {
  if (env.TAVORA_RELEASE_LOCK) return path.resolve(env.TAVORA_RELEASE_LOCK);
  let dir = path.resolve(repo);
  for (let level = 0; level < 3; level++) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
    const releases = path.join(dir, "releases");
    if (existsSync(releases) && statSync(releases).isDirectory()) return path.join(releases, NAME);
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
    if (error.code !== "EEXIST") throw error;
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
