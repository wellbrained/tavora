// `pnpm release:lock-status`: says whether a release holds the RELEASE-RUNNING lock, for a session about to merge
// into main (CLAUDE.md > Versioning). Prints "free", "stale: <line>" or "running: <line>"; exits 0 unless running (1),
// so a merge waits only for a release that is really under way.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockPath, lockStatus, mainCheckoutOf } from "./release-lock.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
let main = null;
try {
  main = mainCheckoutOf(spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" }).stdout);
} catch {}
const file = lockPath(repo, process.env, main);
if (!file) {
  console.log("free (no releases folder, so no release can run here)");
} else {
  const status = lockStatus(file);
  if (status.state === "free") console.log("free");
  else if (status.state === "stale") console.log(`stale (its release is gone; merging is fine, the next release takes it over): ${status.line}`);
  else {
    console.log(`running: ${status.line}`);
    process.exitCode = 1;
  }
}
