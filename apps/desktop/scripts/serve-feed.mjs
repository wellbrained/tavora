// A throwaway update feed for testing: serves the `release` folder over http so
// a test installer (built with --config.publish.url=http://127.0.0.1:<port>)
// can find, download and install a newer test build. Never used for real
// releases; those go to updates.mytavora.app with `pnpm release`. scripts/update-check.mjs serves its test
// feeds with it.
//
//   node scripts/serve-feed.mjs [port] [folder]      (default 8765 and the release folder)
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What to send for a Range header on a file of `size` bytes: { start, end, partial } (end included), or null when the
 * range can't be served (416). "bytes=a-b", "bytes=a-" and the suffix "bytes=-n" (the last n bytes) are read; no header,
 * or one this doesn't read (several ranges), gets the whole file.
 */
export function byteRange(header, size) {
  const whole = { start: 0, end: size - 1, partial: false };
  const range = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!range || (range[1] === "" && range[2] === "")) return whole;
  if (range[1] === "") {
    const last = Number(range[2]);
    if (last === 0) return null;
    return { start: Math.max(0, size - last), end: size - 1, partial: true };
  }
  const start = Number(range[1]);
  const end = range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
  if (start >= size || start > end) return null;
  return { start, end, partial: true };
}

function serve(root, port) {
  createServer((request, response) => {
    const name = path.basename(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
    const file = path.join(root, name);
    let size;
    try {
      const info = statSync(file);
      if (!info.isFile()) throw new Error("not a file");
      size = info.size;
    } catch {
      response.writeHead(404).end();
      console.log(`404 ${name}`);
      return;
    }
    // Differential downloads ask for byte ranges.
    const range = byteRange(request.headers.range, size);
    if (!range) {
      response.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      console.log(`416 ${name} ${request.headers.range}`);
      return;
    }
    const { start, end, partial } = range;
    if (partial) {
      response.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1, "Accept-Ranges": "bytes" });
    } else {
      response.writeHead(200, { "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": name.endsWith(".yml") ? "no-cache" : "public" });
    }
    console.log(`${partial ? 206 : 200} ${name}${partial ? ` ${start}-${end}` : ""}`);
    if (size === 0) return void response.end();
    createReadStream(file, { start, end }).pipe(response);
  }).listen(port, "127.0.0.1", () => console.log(`Test feed on http://127.0.0.1:${port}/ from ${root}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[3] ? path.resolve(process.argv[3]) : path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "release");
  serve(root, Number(process.argv[2] ?? 8765));
}
