// `pnpm release:lock-status`: says whether a release holds the RELEASE-RUNNING lock, for a session about to merge
// into main (CLAUDE.md > Versioning). Prints "free", "stale: <line>", "running: <line>" or "unknown"; exits 0 only for free
// and stale, so a merge waits for a release that is under way or when it can't look.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockPath, lockReport, mainCheckoutOf } from "./release-lock.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
// TAVORA_RELEASE_LOCK names the file itself; otherwise git must say where the main checkout is.
let main = null;
let looked = Boolean(process.env.TAVORA_RELEASE_LOCK);
if (!looked) {
  const listed = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" });
  main = listed.status === 0 && !listed.error ? mainCheckoutOf(listed.stdout) : null;
  looked = main !== null;
}
const report = lockReport(looked ? lockPath(repo, process.env, main) : null, looked);
console.log(report.text);
process.exitCode = report.code;
