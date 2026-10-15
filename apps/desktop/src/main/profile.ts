import { randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./fsutil";
import { IconError, imageType } from "./icons";

/**
 * The player's local profile: no account and no sign-in. The id never
 * changes, so a later account or sync can take this profile and its data over.
 */
export interface Profile {
  version: 1;
  id: string;
  name: string;
  /** Shown instead of the initials taken from the name; empty means automatic. */
  initials: string;
  /** File name in the profile folder, or null for initials or the person icon. */
  picture: string | null;
}

export const MAX_PROFILE_NAME = 32;
export const MAX_INITIALS = 3;
/** The crop dialog always sends this size. */
export const PICTURE_SIZE = 256;
export const MAX_PICTURE_BYTES = 512 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PICTURE_FILE = /^avatar-[0-9a-f]{8}\.png$/;

export function sanitizeProfile(saved: unknown): Profile {
  const value = (typeof saved === "object" && saved !== null ? saved : {}) as Partial<Record<keyof Profile, unknown>>;
  return {
    version: 1,
    id: typeof value.id === "string" && UUID.test(value.id) ? value.id : randomUUID(),
    name: typeof value.name === "string" ? clipName(value.name) : "",
    initials: typeof value.initials === "string" ? clipInitials(value.initials) : "",
    picture: typeof value.picture === "string" && PICTURE_FILE.test(value.picture) ? value.picture : null,
  };
}

/** Keeps a name to the limit, counting characters rather than UTF-16 units. */
export function clipName(name: string): string {
  return [...name.replace(/[\r\n\t]/g, " ")].slice(0, MAX_PROFILE_NAME).join("");
}

/** Up to three characters without spaces, e.g. "NK" or "🐉". */
export function clipInitials(initials: string): string {
  return [...initials.replace(/\s/g, "")].slice(0, MAX_INITIALS).join("");
}

/** Width and height from a PNG's header, or null if it is not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || imageType(bytes) !== "png") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** Checks the cropped picture from the host UI and stores it. Returns the new file name. */
export async function savePicture(dir: string, base64: string): Promise<string> {
  const bytes = Buffer.from(base64, "base64");
  const size = pngSize(bytes);
  if (bytes.length > MAX_PICTURE_BYTES || size?.width !== PICTURE_SIZE || size.height !== PICTURE_SIZE) {
    throw new IconError("error.pictureNotSaved");
  }
  const file = `avatar-${randomBytes(4).toString("hex")}.png`;
  await writeFileAtomic(path.join(dir, file), bytes);
  return file;
}

export async function removePicture(dir: string, file: string | null): Promise<void> {
  if (file) await rm(path.join(dir, path.basename(file)), { force: true });
}
