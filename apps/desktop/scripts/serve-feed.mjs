// A throwaway update feed for testing: serves the `release` folder over http so
// a test installer (built with --config.publish.url=http://127.0.0.1:<port>)
// can find, download and install a newer test build. Never used for real
// releases; those go to updates.mytavora.app with `pnpm release`.
//
//   node scripts/serve-feed.mjs [port]      (default 8765)
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "release");
const port = Number(process.argv[2] ?? 8765);

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
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  const start = range?.[1] ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (range) {
    response.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1, "Accept-Ranges": "bytes" });
  } else {
    response.writeHead(200, { "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": name.endsWith(".yml") ? "no-cache" : "public" });
  }
  console.log(`${range ? 206 : 200} ${name}${range ? ` ${start}-${end}` : ""}`);
  createReadStream(file, { start, end }).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`Test feed on http://127.0.0.1:${port}/ from ${root}`));
