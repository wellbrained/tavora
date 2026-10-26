/**
 * The media connector's real parts (media.ts): starting Tavora's media helper (tavora-media.exe) and turning its
 * covers into small JPEGs. The helper ships in the app's resources; in development it is built into
 * packages/media-helper/bin by `pnpm build` (packages/media-helper/build.mjs).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { nativeImage } from "electron";
import type { MediaDeps, MediaHelper } from "./media";
import { MAX_COVER_BASE64 } from "./media-parse";

/** The longest line Tavora reads from the helper: a cover line with some room. */
const MAX_LINE = MAX_COVER_BASE64 + 64 * 1024;
/** Covers are at most this many pixels a side. */
export const COVER_PX = 300;

/** Where the helper is: next to the app's other resources when packaged, in the repo in development. */
export function helperPath(packaged: boolean, resourcesPath: string, repoRoot: string): string {
  return packaged ? path.join(resourcesPath, "media-helper", "tavora-media.exe") : path.join(repoRoot, "packages", "media-helper", "bin", "tavora-media.exe");
}

/** Starts the helper at `exe`, or answers null when there is none (not Windows, or not built). */
export function startHelper(exe: string, log: (message: string, error?: unknown) => void): MediaHelper | null {
  if (process.platform !== "win32") return null;
  if (!existsSync(exe)) {
    log(`the media helper is missing (${exe}); build it with \`pnpm --filter @tavora/media-helper build\``);
    return null;
  }
  const child = spawn(exe, [], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true, shell: false });
  const lines: ((line: string) => void)[] = [];
  const exits: (() => void)[] = [];
  let gone = false;
  const exited = () => {
    if (gone) return;
    gone = true;
    for (const fn of exits) fn();
  };
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line) for (const fn of lines) fn(line);
    }
    // A line that never ends is not the helper's: drop it rather than grow without end.
    if (buffer.length > MAX_LINE) {
      log("the media helper wrote a line that is too long");
      buffer = "";
    }
  });
  child.stdin.on("error", () => {
    // The helper is gone; its exit says so.
  });
  child.on("error", (error) => {
    log("the media helper failed", error);
    exited();
  });
  child.on("exit", exited);
  return {
    onLine: (fn) => void lines.push(fn),
    onExit: (fn) => void exits.push(fn),
    write: (line) => void child.stdin.write(line),
    kill: () => {
      // Closing its input ends it; the kill is for one that hangs.
      child.stdin.end();
      child.kill();
    },
  };
}

/** A cover from the helper as a JPEG data URL of at most COVER_PX a side, or null when it isn't a picture Chromium reads. */
export function coverDataUrl(bytes: Buffer): string | null {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (width < 1 || height < 1) return null;
  const scale = Math.min(1, COVER_PX / Math.max(width, height));
  const sized = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: "good" }) : image;
  return `data:image/jpeg;base64,${sized.toJPEG(85).toString("base64")}`;
}

export function mediaDeps(exe: string, log: (message: string, error?: unknown) => void): MediaDeps {
  return { start: () => startHelper(exe, log), cover: (bytes) => coverDataUrl(bytes), log };
}
