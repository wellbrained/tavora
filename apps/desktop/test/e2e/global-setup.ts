import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A fresh checkout or worktree has no build, and Electron then opens its own
// "no app found" window instead of Tavora. CI and `pnpm release` build before
// the e2e step; this covers running the suite by hand.
export default function globalSetup(): void {
  const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  if (existsSync(path.join(desktopDir, "out/main/index.cjs"))) return;
  console.log("No build found in out/, building first...");
  const run = spawnSync("node", ["scripts/build.mjs"], { cwd: desktopDir, stdio: "inherit" });
  if (run.status !== 0) throw new Error("The build failed, so the e2e tests cannot start.");
}
