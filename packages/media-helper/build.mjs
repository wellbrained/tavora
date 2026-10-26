// Builds tavora-media.exe into bin/, where Tavora looks for it in development and from where packaging copies it
// (apps/desktop/package.json, extraResources). Windows only: elsewhere there is nothing to build and Tavora's
// Media connector says it isn't available. On Windows a missing Rust toolchain fails the build, so a release can't
// ship without the helper; TAVORA_SKIP_MEDIA_HELPER=1 builds without it on purpose.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

if (process.platform !== "win32") {
  console.log("[media-helper] not Windows, nothing to build");
  process.exit(0);
}
if (process.env.TAVORA_SKIP_MEDIA_HELPER === "1") {
  console.log("[media-helper] skipped (TAVORA_SKIP_MEDIA_HELPER=1); the Media connector won't work in this build");
  process.exit(0);
}

const cargo = spawnSync("cargo", ["build", "--release", "--locked"], { cwd: here, stdio: "inherit", shell: false });
if (cargo.error || cargo.status !== 0) {
  console.error(
    cargo.error?.code === "ENOENT"
      ? "[media-helper] Rust isn't installed. Install it once with `winget install Rustlang.Rustup` (and the Visual Studio C++ Build Tools), or set TAVORA_SKIP_MEDIA_HELPER=1."
      : "[media-helper] cargo build failed",
  );
  process.exit(1);
}
mkdirSync(path.join(here, "bin"), { recursive: true });
copyFileSync(path.join(here, "target", "release", "tavora-media.exe"), path.join(here, "bin", "tavora-media.exe"));
console.log("[media-helper] bin/tavora-media.exe");
