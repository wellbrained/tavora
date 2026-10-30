// The module address for stored files (see blobs.ts): POST /_blobs/ stores a picture and answers
// with its description, GET /_blobs/<id> serves it. Answered inside the module's own session, so
// a page can only reach the files of its own module and workspace.

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { BLOB_ID, BLOB_PATH, type ErrorCode } from "@tavora/sdk/protocol";
import type { BlobStore } from "./blobs";
import { HostError } from "./errors";

const STATUS: Partial<Record<ErrorCode, number>> = { QUOTA_EXCEEDED: 413, INVALID_PARAMS: 415 };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function failure(error: unknown): Response {
  if (error instanceof HostError) return json(STATUS[error.code] ?? 400, { error: error.toPayload() });
  console.error("[tavora] blob store error", error);
  return json(500, { error: { code: "INTERNAL", message: "internal error" } });
}

export async function serveBlobs(store: BlobStore, request: Request, url: URL): Promise<Response> {
  const rest = url.pathname.slice(BLOB_PATH.length);

  if (rest === "") {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!request.body) return failure(new HostError("INVALID_PARAMS", "send the file as the request body"));
    const length = Number(request.headers.get("content-length"));
    try {
      return json(201, await store.put(request.body as unknown as AsyncIterable<Uint8Array>, Number.isFinite(length) && length > 0 ? length : undefined));
    } catch (error) {
      return failure(error);
    }
  }

  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  if (!BLOB_ID.test(rest)) return new Response("Not found", { status: 404 });
  const found = await store.open(rest);
  if (!found) return new Response("Not found", { status: 404 });
  const body = request.method === "HEAD" ? null : (Readable.toWeb(createReadStream(found.file)) as unknown as ReadableStream);
  return new Response(body, {
    headers: {
      "Content-Type": found.type,
      "Content-Length": String(found.bytes),
      "X-Content-Type-Options": "nosniff",
      // A PDF is data for the module to read, never a page the host shows.
      ...(found.type === "application/pdf" ? { "Content-Disposition": "attachment" } : {}),
      // A picture is shown, never run: nothing in it can load or script anything.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      // An id never points at different bytes, so the page may keep what it fetched.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
