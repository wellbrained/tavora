// The module address for saving a picture as a file (see png.ts): POST /_pictures/?name=… with a PNG as the body.
// Like the clipboard, it works only right after the user clicked or pressed a key in the module (one picture per
// click), and only for a complete, well-formed PNG within the size limits. Tavora's save dialog asks the user where
// it goes (host.ts); the module only suggests its name and learns the name it was saved under, or null when the
// user closed the dialog, never where the folder is.

import { LIMITS } from "@tavora/sdk/protocol";
import { CLIPBOARD_PNG_LIMITS, json, readBody, STATUS } from "./clipboard-http";
import { HostError } from "./errors";
import { checkPng } from "./png";

export interface PictureSaveDeps {
  allowed(): boolean;
  consume(): void;
  /** Writes the checked PNG under a name made from `name`, and returns the file name used, or null when the user did not save it. */
  save(png: Buffer, name: string): Promise<string | null>;
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

/** The first of "name.png", "name (2).png", … that is not taken (another `extension`, such as "json", for other files). */
export function freeFileName(name: string, taken: (fileName: string) => boolean, extension = "png"): string {
  for (let count = 1; count < 10_000; count++) {
    const fileName = count === 1 ? `${name}.${extension}` : `${name} (${count}).${extension}`;
    if (!taken(fileName)) return fileName;
  }
  throw new HostError("QUOTA_EXCEEDED", "too many files with this name");
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
