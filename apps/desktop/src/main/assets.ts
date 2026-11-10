import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export const MODULE_SCHEME = "tavora-module";
export const HOST_SCHEME = "tavora-host";
/** The address of a game overlay's page inside its own window (game-overlay-page.ts). */
export const GAME_OVERLAY_SCHEME = "tavora-overlay";

// Applied to every file of a module's bundle. Modules may only load what is
// inside their own bundle; there is no remote code, no remote connections, no
// plugins and no frames: a frame of the module's own origin would be a realm
// of its own, where the policy of the page around it no longer counts.
// Inline styles are allowed because most UI frameworks set them.
export const MODULE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The policy for one module. WebAssembly may be compiled only when the module asked for it and is one of Tavora's own
 * (the registry refuses the request from any other); that adds `'wasm-unsafe-eval'`, which allows WebAssembly and nothing else
 * (no eval of strings, no inline script).
 */
export function moduleCsp(webAssembly: boolean): string {
  return webAssembly ? MODULE_CSP.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'") : MODULE_CSP;
}

/**
 * For every other answer of a module's origin (not found, not allowed, the answers of its routes): nothing in it runs,
 * and it is never a document of the module's origin. Without it such a page has no policy at all, so code compiled in a
 * frame of it would get around the module's (W1, W2).
 */
export const MODULE_ROUTE_CSP = "default-src 'none'; sandbox";

/**
 * Every answer of a module's origin with a content security policy and nosniff: one it set itself is kept (a bundle
 * file has the module's), any other gets MODULE_ROUTE_CSP.
 */
export function withModulePolicy(response: Response): Response {
  const needs = !response.headers.has("Content-Security-Policy") || response.headers.get("X-Content-Type-Options") !== "nosniff";
  if (!needs) return response;
  const headers = new Headers(response.headers);
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", MODULE_ROUTE_CSP);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const HOST_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Maps a URL path to a file inside `rootReal` (which must already be a real
 * path). Returns null for anything that is not a regular file inside the
 * root: traversal, encoded separators, null bytes, or symlinks pointing out.
 */
export async function resolveAsset(rootReal: string, urlPathname: string): Promise<string | null> {
  const segments: string[] = [];
  for (const raw of urlPathname.split("/").slice(1)) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === "" || segment === "." || segment === "..") return null;
    if (segment.includes("/") || segment.includes("\\") || segment.includes("\0")) return null;
    segments.push(segment);
  }
  if (segments.length === 0) return null;

  let real: string;
  try {
    real = await realpath(path.join(rootReal, ...segments));
  } catch {
    return null;
  }
  if (!real.startsWith(rootReal + path.sep)) return null;

  try {
    return (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}
