// The module addresses for saving and opening a .csv or .xlsx through Tavora's own dialogs (see json-file-http.ts for
// the JSON ones these follow):
//   POST /_files/save/?type=csv|xlsx&name=…  with the file's bytes as the body   -> { fileName } or { fileName: null }
//   POST /_files/open/?types=csv,xlsx                                            -> the file's bytes (name and kind in
//                                                                                   headers), or null
// Both work only right after the user clicked or pressed a key in the module (one per click). The user picks every
// file in the dialog (host.ts); the module only suggests a name and gets back a name, or the bytes of the file the
// user chose, never a path. Only these two extensions can be chosen, and a file is at most 8 MiB.

import { open } from "node:fs/promises";
import { FILE_KIND_HEADER, FILE_KINDS, FILE_NAME_HEADER, MAX_FILE_BYTES, type FileKind } from "@tavora/sdk/protocol";
import { json, readBody, STATUS } from "./clipboard-http";
import { HostError } from "./errors";

export interface TableSaveDeps {
  allowed(): boolean;
  consume(): void;
  /** Writes the checked bytes under a name made from `name` with the extension of `kind`, and returns the file name used, or null when the user did not save it. */
  save(data: Buffer, name: string, kind: FileKind): Promise<string | null>;
}

export interface TableOpenDeps {
  allowed(): boolean;
  consume(): void;
  /** Lets the user pick one of `kinds`; answers with its name, kind and checked bytes, or null when the user closed the dialog. */
  open(kinds: FileKind[]): Promise<{ fileName: string; kind: FileKind; bytes: Buffer } | null>;
}

const isKind = (value: unknown): value is FileKind => FILE_KINDS.includes(value as FileKind);

/** The kind a file name stands for, or undefined for any other extension. */
export function kindOfName(fileName: string): FileKind | undefined {
  const extension = /\.([^.\\/]+)$/.exec(fileName)?.[1]?.toLowerCase();
  return isKind(extension) ? extension : undefined;
}

/** What the module sent must look like the file it says it is: a CSV is UTF-8 text, a workbook is a zip. Anything else is INVALID_PARAMS. */
export function checkFileBytes(kind: FileKind, bytes: Uint8Array): void {
  if (kind === "xlsx") {
    // A workbook is a zip archive, which starts with "PK" and a record number.
    const zip = bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);
    if (!zip) throw new HostError("INVALID_PARAMS", "send a complete .xlsx file");
    return;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HostError("INVALID_PARAMS", "a .csv file must be UTF-8 text");
  }
}

/** Reads a file of at most 8 MiB; a bigger one is QUOTA_EXCEEDED, and anything that is not a regular file is INVALID_PARAMS. */
export async function readTableFile(file: string): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new HostError("INVALID_PARAMS", "this is not a file");
    if (info.size > MAX_FILE_BYTES) throw new HostError("QUOTA_EXCEEDED", "a file can be at most 8 MiB");
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_FILE_BYTES) throw new HostError("QUOTA_EXCEEDED", "a file can be at most 8 MiB");
    return bytes;
  } finally {
    await handle.close();
  }
}

function failure(error: unknown, what: string): Response {
  if (error instanceof HostError) return json(STATUS[error.code] ?? 400, { error: error.toPayload() });
  console.error(`[tavora] ${what} error`, error);
  return json(500, { error: { code: "INTERNAL", message: "internal error" } });
}

export async function serveFileSave(request: Request, url: URL, deps: TableSaveDeps, clean: (name: string) => string): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    if (!deps.allowed()) throw new HostError("PERMISSION_DENIED", "a file can only be saved right after a click or key press");
    deps.consume();
    const kind = url.searchParams.get("type");
    if (!isKind(kind)) throw new HostError("INVALID_PARAMS", "only a csv or xlsx file can be saved");
    if (!request.body) throw new HostError("INVALID_PARAMS", "send the file as the request body");
    const bytes = await readBody(request, MAX_FILE_BYTES, "a file to save");
    checkFileBytes(kind, bytes);
    const fileName = await deps.save(bytes, clean(url.searchParams.get("name") ?? ""), kind);
    return json(200, { fileName });
  } catch (error) {
    return failure(error, "file save");
  }
}

export async function serveFileOpen(request: Request, url: URL, deps: TableOpenDeps): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    if (!deps.allowed()) throw new HostError("PERMISSION_DENIED", "a file can only be opened right after a click or key press");
    deps.consume();
    const asked = (url.searchParams.get("types") ?? FILE_KINDS.join(",")).split(",");
    if (!asked.length || !asked.every(isKind)) throw new HostError("INVALID_PARAMS", "only csv and xlsx files can be opened");
    const picked = await deps.open([...new Set(asked)]);
    if (!picked) return json(200, null);
    return new Response(new Uint8Array(picked.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        [FILE_NAME_HEADER]: encodeURIComponent(picked.fileName),
        [FILE_KIND_HEADER]: picked.kind,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error, "file open");
  }
}
