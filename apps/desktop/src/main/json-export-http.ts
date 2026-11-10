// Bounded JSON export after one trusted gesture, into a fixed host-owned folder.
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { cleanPictureName } from "./picture-save-http";
import { json, readBody, STATUS } from "./clipboard-http";
import { HostError } from "./errors";
// Room for a guide build with its original source text (the largest seen is about 2.3 MiB).
export const MAX_JSON_EXPORT_BYTES = 8 * 1024 * 1024;
/** What one module may export in an hour: plenty for saving builds by hand, not a folder filled by a held key. */
export const JSON_EXPORT_QUOTA = { files: 30, bytes: 64 * 1024 * 1024, windowMs: 60 * 60 * 1000 };
/** Exports per module over the last window, kept while Tavora runs. */
export class ExportQuota {
  private readonly used = new Map<string, { at: number; bytes: number }[]>();
  constructor(
    private readonly limit = JSON_EXPORT_QUOTA,
    private readonly now = Date.now,
  ) {}
  /** Books one export of `bytes` for `key`, or refuses; the returned function gives it back when the write fails. */
  take(key: string, bytes: number): () => void {
    const since = this.now() - this.limit.windowMs;
    const recent = (this.used.get(key) ?? []).filter((entry) => entry.at > since);
    const total = recent.reduce((sum, entry) => sum + entry.bytes, 0);
    if (recent.length >= this.limit.files || total + bytes > this.limit.bytes) {
      this.used.set(key, recent);
      throw new HostError("QUOTA_EXCEEDED", "too many exports for now; try again later");
    }
    const entry = { at: this.now(), bytes };
    recent.push(entry);
    this.used.set(key, recent);
    return () => {
      const list = this.used.get(key);
      const at = list?.indexOf(entry) ?? -1;
      if (at >= 0) list!.splice(at, 1);
    };
  }
}
const jsonExportQuota = new ExportQuota();
export interface JsonExportDeps {
  allowed(): boolean;
  consume(): void;
  save(data: Buffer, name: string): Promise<string>;
}
export async function saveJsonExport(
  folder: string,
  data: Buffer,
  name: string,
): Promise<string> {
  await mkdir(folder, { recursive: true });
  for (let n = 1; n < 10000; n++) {
    const fileName =
      cleanPictureName(name) + (n === 1 ? "" : " (" + n + ")") + ".json";
    const target = path.join(folder, fileName);
    let file;
    try {
      file = await open(target, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    try {
      await file.writeFile(data);
      await file.close();
      return fileName;
    } catch (error) {
      await file.close().catch(() => {});
      await unlink(target).catch(() => {});
      throw error;
    }
  }
  throw new HostError("QUOTA_EXCEEDED", "too many exports with this name");
}
export async function serveJsonExport(
  request: Request,
  url: URL,
  deps: JsonExportDeps,
  quota: ExportQuota = jsonExportQuota,
): Promise<Response> {
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  try {
    if (!deps.allowed())
      throw new HostError(
        "PERMISSION_DENIED",
        "export requires a click or key press",
      );
    deps.consume();
    if (!request.body)
      throw new HostError("INVALID_PARAMS", "send JSON as the request body");
    const bytes = await readBody(
      request,
      MAX_JSON_EXPORT_BYTES,
      "a JSON export",
    );
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new HostError("INVALID_PARAMS", "send a valid JSON document");
    }
    const data = Buffer.from(JSON.stringify(value, null, 2) + "\n");
    if (data.byteLength > MAX_JSON_EXPORT_BYTES)
      throw new HostError("QUOTA_EXCEEDED", "formatted JSON exceeds 8 MiB");
    // The address's host is the module's id (the protocol handler answers only its own).
    const giveBack = quota.take(url.host, data.byteLength);
    try {
      return json(200, {
        fileName: await deps.save(
          data,
          cleanPictureName(url.searchParams.get("name") ?? "Build"),
        ),
      });
    } catch (error) {
      giveBack();
      throw error;
    }
  } catch (error) {
    if (error instanceof HostError)
      return json(STATUS[error.code] ?? 400, { error: error.toPayload() });
    return json(500, {
      error: { code: "INTERNAL", message: "could not export the JSON file" },
    });
  }
}
