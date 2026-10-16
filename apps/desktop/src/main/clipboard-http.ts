// The module address for putting a picture on the system clipboard (see png.ts): POST /_clipboard/ with a PNG as
// the body. It works only right after the player clicked or pressed a key in the module (one picture per click),
// and only for a complete, well-formed PNG within the size limits.

import { LIMITS, type ErrorCode } from "@tavora/sdk/protocol";
import { HostError } from "./errors";
import { checkPng, type PngLimits } from "./png";

export const CLIPBOARD_PNG_LIMITS: PngLimits = { maxSide: 16384, maxPixels: 100_000_000 };

export interface ClipboardDeps {
  /** Whether the player did something in the module just now. */
  allowed(): boolean;
  /** Uses that up, so one click puts one picture on the clipboard. */
  consume(): void;
  /** Puts the checked PNG on the clipboard. */
  write(png: Buffer): void | Promise<void>;
}

const STATUS: Partial<Record<ErrorCode, number>> = { PERMISSION_DENIED: 403, QUOTA_EXCEEDED: 413, INVALID_PARAMS: 415 };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function readBody(request: Request, max: number): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new HostError("QUOTA_EXCEEDED", `a picture for the clipboard can be at most ${max} bytes`);
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > max) throw new HostError("QUOTA_EXCEEDED", `a picture for the clipboard can be at most ${max} bytes`);
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

export async function serveClipboard(request: Request, deps: ClipboardDeps): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    if (!deps.allowed()) throw new HostError("PERMISSION_DENIED", "the clipboard can only be written right after a click or key press");
    deps.consume();
    if (!request.body) throw new HostError("INVALID_PARAMS", "send the PNG as the request body");
    const png = await readBody(request, LIMITS.maxClipboardImageBytes);
    const checked = checkPng(png, CLIPBOARD_PNG_LIMITS);
    if (!checked.ok) throw new HostError("INVALID_PARAMS", `only a complete PNG picture can be copied: ${checked.reason}`);
    await deps.write(png);
    return json(200, { ok: true });
  } catch (error) {
    if (error instanceof HostError) return json(STATUS[error.code] ?? 400, { error: error.toPayload() });
    console.error("[tavora] clipboard error", error);
    return json(500, { error: { code: "INTERNAL", message: "internal error" } });
  }
}
