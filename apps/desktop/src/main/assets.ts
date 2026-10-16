import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export const MODULE_SCHEME = "tavora-module";
export const HOST_SCHEME = "tavora-host";

// Applied to every module response. Modules may only load what is inside
// their own bundle; there is no remote code, no remote connections and no
// plugins. Inline styles are allowed because most UI frameworks set them.
export const MODULE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "child-src 'self'",
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
