import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A fresh checkout or worktree has no build, and Electron then opens its own
// "no app found" window instead of Tavora, while the modules in modules/ never
// show up. CI and `pnpm release` build before the e2e step; this covers running
// the suite by hand, and does nothing when everything is built.
export default function globalSetup(): void {
  const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  if (!existsSync(path.join(desktopDir, "out/main/index.cjs"))) {
    console.log("No build found in out/, building first...");
    const run = spawnSync("node", ["scripts/build.mjs"], { cwd: desktopDir, stdio: "inherit" });
    if (run.status !== 0) throw new Error("The build failed, so the e2e tests cannot start.");
  }
  buildMissingModules(path.resolve(desktopDir, "../.."));
}

// Builds each module in modules/ whose manifest entry is missing, together with
// the workspace packages it uses (pnpm's `name...` filter).
function buildMissingModules(repoDir: string): void {
  const modulesDir = path.join(repoDir, "modules");
  const missing = readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(modulesDir, entry.name))
    .filter((dir) => existsSync(path.join(dir, "tavora.module.json")) && existsSync(path.join(dir, "package.json")))
    .filter((dir) => {
      const manifest = JSON.parse(readFileSync(path.join(dir, "tavora.module.json"), "utf8")) as { entry: string };
      return !existsSync(path.join(dir, manifest.entry));
    })
    .map((dir) => (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { name: string }).name);
  if (missing.length === 0) return;
  console.log(`Modules without a build: ${missing.join(", ")}. Building them first...`);
  const filters = missing.flatMap((name) => ["--filter", `${name}...`]);
  const run = spawnSync("pnpm", [...filters, "build"], { cwd: repoDir, stdio: "inherit", shell: process.platform === "win32" });
  if (run.status !== 0) throw new Error("Building the modules failed, so the e2e tests cannot start.");
}
