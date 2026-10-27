// The module addresses for saving and opening a JSON file through Tavora's own dialogs (see json-export-http.ts for
// the older export that writes into Downloads without asking):
//   POST /_files/json/save?name=…  with the JSON as the body    -> { fileName } or { fileName: null }
//   POST /_files/json/open                                      -> { fileName, value } or null
// Both work only right after the user clicked or pressed a key in the module (one per click). The user picks
// every file in the dialog (host.ts); the module only suggests a name and gets back a name, or the parsed value of
// the file the user chose, never a path. They are module addresses rather than bridge calls so a document up to
// 8 MiB does not go through the bridge's message limit, like pictures.save and exportJson.

import { open } from "node:fs/promises";
import { json, readBody, STATUS } from "./clipboard-http";
import { HostError } from "./errors";
import { MAX_JSON_EXPORT_BYTES } from "./json-export-http";

export interface JsonSaveDeps {
  allowed(): boolean;
  consume(): void;
  /** Writes the formatted JSON under a name made from `name`, and returns the file name used, or null when the user did not save it. */
  save(data: Buffer, name: string): Promise<string | null>;
}

export interface JsonOpenDeps {
  allowed(): boolean;
  consume(): void;
  /** Lets the user pick a file; answers with its name and the checked, read text, or null when the user closed the dialog. */
  open(): Promise<{ fileName: string; text: string } | null>;
}

/** The JSON as Tavora writes a saved file: two-space indent and a final newline, the same as exportJson. */
export function formatJson(value: unknown): Buffer {
  const data = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  if (data.byteLength > MAX_JSON_EXPORT_BYTES) throw new HostError("QUOTA_EXCEEDED", "formatted JSON exceeds 8 MiB");
  return data;
}

/** Reads a text file of at most 8 MiB; a bigger one is QUOTA_EXCEEDED, and a file that is not UTF-8 text is INVALID_PARAMS. */
export async function readJsonText(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new HostError("INVALID_PARAMS", "this is not a file");
    if (info.size > MAX_JSON_EXPORT_BYTES) throw new HostError("QUOTA_EXCEEDED", "a JSON file can be at most 8 MiB");
    const bytes = await handle.readFile();
    if (bytes.byteLength > MAX_JSON_EXPORT_BYTES) throw new HostError("QUOTA_EXCEEDED", "a JSON file can be at most 8 MiB");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new HostError("INVALID_PARAMS", "this file is not a JSON text file");
    }
  } finally {
    await handle.close();
  }
}

function failure(error: unknown, what: string): Response {
  if (error instanceof HostError) return json(STATUS[error.code] ?? 400, { error: error.toPayload() });
  console.error(`[tavora] ${what} error`, error);
  return json(500, { error: { code: "INTERNAL", message: "internal error" } });
}

export async function serveJsonSave(request: Request, url: URL, deps: JsonSaveDeps, clean: (name: string) => string): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    if (!deps.allowed()) throw new HostError("PERMISSION_DENIED", "a file can only be saved right after a click or key press");
    deps.consume();
    if (!request.body) throw new HostError("INVALID_PARAMS", "send JSON as the request body");
    const bytes = await readBody(request, MAX_JSON_EXPORT_BYTES, "a JSON file to save");
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new HostError("INVALID_PARAMS", "send a valid JSON document");
    }
    const fileName = await deps.save(formatJson(value), clean(url.searchParams.get("name") ?? ""));
    return json(200, { fileName });
  } catch (error) {
    return failure(error, "json save");
  }
}

export async function serveJsonOpen(request: Request, deps: JsonOpenDeps): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    if (!deps.allowed()) throw new HostError("PERMISSION_DENIED", "a file can only be opened right after a click or key press");
    deps.consume();
    const picked = await deps.open();
    if (!picked) return json(200, null);
    let value: unknown;
    try {
      value = JSON.parse(picked.text);
    } catch {
      throw new HostError("INVALID_PARAMS", `${picked.fileName} is not valid JSON`);
    }
    return json(200, { fileName: picked.fileName, value });
  } catch (error) {
    return failure(error, "json open");
  }
}
