// The game pictures of the Overlay layout: one PNG per game in the data folder, taken on the user's click from the
// game's window or picked from a file, kept on this PC, never sent anywhere, and removable. This file holds the files and
// the matching of a window to capture; Electron's part (desktopCapturer, decoding a chosen image) lives in the host.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./fsutil";

/** The folder inside the data folder, and the address prefix the host UI serves it under. */
export const PICTURES_FOLDER = "overlay-pictures";

/** A picture is a screenshot: bigger than this is not one, and is not kept. */
export const MAX_PICTURE_BYTES = 30 * 1024 * 1024;
/** Pictures are kept no wider than this, so a 4K screenshot is fine and a panorama isn't a burden. */
export const MAX_PICTURE_WIDTH = 3840;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Whether the bytes begin like a PNG file. */
export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** The file name a game's picture is kept under: the game id is hashed, so it never needs to be a safe file name. */
export function pictureName(gameId: string): string {
  return `${createHash("sha256").update(gameId).digest("hex").slice(0, 24)}.png`;
}

export type SaveResult = "saved" | "not-a-picture" | "too-big";

export class LayoutPictures {
  constructor(readonly dir: string) {}

  file(gameId: string): string {
    return path.join(this.dir, pictureName(gameId));
  }

  /** The address (relative to the host UI's origin) of a game's picture with a version that changes when it does, or null when it has none. */
  async address(gameId: string): Promise<string | null> {
    try {
      const info = await stat(this.file(gameId));
      return info.isFile() ? `${PICTURES_FOLDER}/${pictureName(gameId)}?v=${Math.round(info.mtimeMs)}` : null;
    } catch {
      return null;
    }
  }

  async has(gameId: string): Promise<boolean> {
    return (await this.address(gameId)) !== null;
  }

  /** Keeps PNG bytes as the game's picture. Anything else is refused. */
  async save(gameId: string, png: Uint8Array): Promise<SaveResult> {
    if (!isPng(png)) return "not-a-picture";
    if (png.length > MAX_PICTURE_BYTES) return "too-big";
    await mkdir(this.dir, { recursive: true });
    await writeFileAtomic(this.file(gameId), png);
    return "saved";
  }

  /** The picture's bytes, or null. */
  async read(gameId: string): Promise<Buffer | null> {
    return readFile(this.file(gameId)).catch(() => null);
  }

  /** Removes the game's picture; whether there was one. */
  async remove(gameId: string): Promise<boolean> {
    const had = await this.has(gameId);
    await rm(this.file(gameId), { force: true });
    return had;
  }
}

/** One window a screen capture could take, as the OS lists them (Electron's desktopCapturer source). */
export interface CaptureSource {
  id: string;
  name: string;
}

/**
 * The source of the game's window: the one whose id names the window handle Tavora saw in front (`window:<handle>:<n>`).
 * Nothing else matches, not a title, so a picture is never taken of another window with a similar name.
 */
export function sourceForHandle<T extends CaptureSource>(sources: readonly T[], handle: string): T | undefined {
  if (!/^\d{1,20}$/.test(handle)) return undefined;
  return sources.find((source) => source.id.startsWith(`window:${handle}:`));
}

/** The size a picture of a window of this shape and size is asked at: the window's pixels, never above MAX_PICTURE_WIDTH. */
export function captureSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1920, height: 1080 };
  const scale = Math.min(1, MAX_PICTURE_WIDTH / width);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
