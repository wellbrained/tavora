// The module address for saving a picture as a file (see png.ts): POST /_pictures/?name=… with a PNG as the body.
// Like the clipboard, it works only right after the player clicked or pressed a key in the module (one picture per
// click), and only for a complete, well-formed PNG within the size limits. The file always goes into Tavora's own
// folder in the player's Pictures, as a new .png that never replaces another; the module only suggests its name and
// learns the name it was saved under, never where the folder is.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { LIMITS } from "@tavora/sdk/protocol";
import { CLIPBOARD_PNG_LIMITS, json, readBody, STATUS } from "./clipboard-http";
import { HostError } from "./errors";
import { checkPng } from "./png";

export interface PictureSaveDeps {
  allowed(): boolean;
  consume(): void;
  /** Writes the checked PNG under a name made from `name`, and returns the file name used. */
  save(png: Buffer, name: string): Promise<string>;
}

/** Longest file name (without .png) a module can suggest. */
export const MAX_PICTURE_NAME = 80;

// Characters Windows does not allow in a file name, and control characters.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** A safe file name (without .png) from what the module suggested; "Picture" when nothing is left. */
export function cleanPictureName(value: string): string {
  let name = value.replace(UNSAFE, " ").replace(/\s+/g, " ").trim().slice(0, MAX_PICTURE_NAME).trim();
  // Windows drops trailing dots and spaces, and a name may not start with a dot here (no hidden files).
  name = name.replace(/^[.\s]+|[.\s]+$/g, "");
  if (!name || RESERVED.test(name)) return "Picture";
  return name;
}

/** The first of "name.png", "name (2).png", … that is not taken. */
export function freeFileName(name: string, taken: (fileName: string) => boolean): string {
  for (let count = 1; count < 10_000; count++) {
    const fileName = count === 1 ? `${name}.png` : `${name} (${count}).png`;
    if (!taken(fileName)) return fileName;
  }
  throw new HostError("QUOTA_EXCEEDED", "too many pictures with this name");
}

/** Writes a picture into `folder` (made when missing) under the first free name; never replaces a file. */
export async function savePictureFile(folder: string, png: Buffer, name: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  const tried = new Set<string>();
  for (;;) {
    const fileName = freeFileName(name, (candidate) => tried.has(candidate));
    tried.add(fileName);
    try {
      await writeFile(path.join(folder, fileName), png, { flag: "wx" });
      return fileName;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

export async function servePictureSave(request: Request, url: URL, deps: PictureSaveDeps): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    if (!deps.allowed()) throw new HostError("PERMISSION_DENIED", "a picture can only be saved right after a click or key press");
    deps.consume();
    if (!request.body) throw new HostError("INVALID_PARAMS", "send the PNG as the request body");
    const png = await readBody(request, LIMITS.maxClipboardImageBytes, "a picture to save");
    const checked = checkPng(png, CLIPBOARD_PNG_LIMITS);
    if (!checked.ok) throw new HostError("INVALID_PARAMS", `only a complete PNG picture can be saved: ${checked.reason}`);
    const fileName = await deps.save(png, cleanPictureName(url.searchParams.get("name") ?? ""));
    return json(200, { fileName });
  } catch (error) {
    if (error instanceof HostError) return json(STATUS[error.code] ?? 400, { error: error.toPayload() });
    console.error("[tavora] picture save error", error);
    return json(500, { error: { code: "INTERNAL", message: "internal error" } });
  }
}
