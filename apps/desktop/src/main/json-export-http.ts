// Bounded JSON export after one trusted gesture, into a fixed host-owned folder.
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { cleanPictureName } from "./picture-save-http";
import { json, readBody, STATUS } from "./clipboard-http";
import { HostError } from "./errors";
// Room for a guide build with its original source text (the largest seen is about 2.3 MiB).
export const MAX_JSON_EXPORT_BYTES = 8 * 1024 * 1024;
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
    return json(200, {
      fileName: await deps.save(
        data,
        cleanPictureName(url.searchParams.get("name") ?? "Build"),
      ),
    });
  } catch (error) {
    if (error instanceof HostError)
      return json(STATUS[error.code] ?? 400, { error: error.toPayload() });
    return json(500, {
      error: { code: "INTERNAL", message: "could not export the JSON file" },
    });
  }
}
