// Stands between the Tavora service and clamd: a socket that passes on only what a scan needs (INSTREAM, plus PING and
// VERSION), so code running as the service can't ask clamd to SCAN a path on the server (a yes/no oracle on files clamd
// can read), RELOAD it or SHUTDOWN it. clamd has no setting to turn commands off, hence this filter.
//
// Installed by the server setup as /usr/local/lib/tavora/tavora-clamd-filter.mjs (root's, never a deploy's) and run by
// tavora-clamd-filter.service as clamav, the user that may reach clamd's own socket; the service only reaches this one.
//
//   node tavora-clamd-filter.mjs <listen socket> <clamd socket> [clamd.conf]
import { chmodSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { pathToFileURL } from "node:url";

/** Commands passed on: the scan of a stream the service sends, and the two clamav.sh's status asks. */
const ALLOWED = new Set(["INSTREAM", "PING", "VERSION"]);
/** The longest command read before the terminator ("zINSTREAM\0" is 10 bytes). */
const MAX_COMMAND = 32;
/** clamd's own default StreamMaxLength; the service never sends more than 20 MB as one stream. */
export const DEFAULT_STREAM_MAX = 25 * 1024 * 1024;
/** Connections at once; the service scans a few files at a time. */
const MAX_CONNECTIONS = 16;
/** A connection with no bytes either way for this long is closed (clamd took 53 s for a 13.6 MB zip). */
const IDLE_MS = 10 * 60 * 1000;

/**
 * Reads a connection's command, then passes on exactly one allowed command and, for INSTREAM, its chunks up to the
 * closing zero-length one. Anything after that, or any other command, is never sent to clamd.
 */
function handle(client, upstreamPath, maxStream, onClose) {
  client.setTimeout(IDLE_MS, () => client.destroy());
  let buffered = Buffer.alloc(0);
  let upstream = null;
  // "command" until the command is read; then "length" / "chunk" for INSTREAM; "done" once nothing more may pass.
  let state = "command";
  let chunkLeft = 0;
  let streamed = 0;
  const close = () => {
    client.destroy();
    upstream?.destroy();
  };
  client.on("close", () => {
    upstream?.destroy();
    onClose();
  });
  client.on("error", close);

  // While clamd reads slower than the service sends, the service waits: no stream piles up in this process's memory.
  const forward = (bytes) => {
    if (bytes.length > 0 && !upstream.write(bytes)) {
      client.pause();
      upstream.once("drain", () => client.resume());
    }
  };
  const openUpstream = (command) => {
    upstream = net.createConnection({ path: upstreamPath });
    upstream.setTimeout(IDLE_MS, close);
    upstream.on("error", close);
    // Once clamd answers (a verdict, or "size limit exceeded"), it reads nothing more: neither does it get anything more.
    upstream.on("data", (data) => {
      state = "done";
      buffered = Buffer.alloc(0);
      client.write(data);
    });
    upstream.on("end", () => {
      state = "done";
      client.end();
    });
    upstream.on("close", () => client.end());
    upstream.write(command);
  };

  client.on("data", (data) => {
    if (state === "done") return;
    buffered = buffered.length ? Buffer.concat([buffered, data]) : data;
    if (state === "command") {
      const prefix = buffered[0];
      const terminator = prefix === 0x7a ? 0 : prefix === 0x6e ? 0x0a : -1; // z...\0 or n...\n
      const end = terminator < 0 ? -1 : buffered.indexOf(terminator);
      if (terminator < 0 || (end < 0 && buffered.length > MAX_COMMAND) || end > MAX_COMMAND) return close();
      if (end < 0) return;
      const name = buffered.subarray(1, end).toString("latin1");
      if (!ALLOWED.has(name)) return close();
      openUpstream(buffered.subarray(0, end + 1));
      buffered = buffered.subarray(end + 1);
      if (name !== "INSTREAM") {
        state = "done";
        return;
      }
      state = "length";
    }
    // INSTREAM: each chunk is a 4-byte big-endian length and that many bytes; a length of 0 ends the stream.
    while (buffered.length > 0 && state !== "done") {
      if (state === "length") {
        if (buffered.length < 4) return;
        chunkLeft = buffered.readUInt32BE(0);
        streamed += chunkLeft;
        if (streamed > maxStream) return close();
        forward(buffered.subarray(0, 4));
        buffered = buffered.subarray(4);
        state = chunkLeft === 0 ? "done" : "chunk";
      } else {
        const take = Math.min(chunkLeft, buffered.length);
        forward(buffered.subarray(0, take));
        buffered = buffered.subarray(take);
        chunkLeft -= take;
        if (chunkLeft === 0) state = "length";
      }
    }
    if (state === "done") buffered = Buffer.alloc(0);
  });
}

/**
 * clamd's StreamMaxLength from its config ("25M", "100K", a number of bytes), so the filter never takes a longer stream
 * than clamd would; its default when the config doesn't say.
 */
export function streamLimit(config) {
  const match = /^[ \t]*StreamMaxLength[ \t]+(\d+)([KkMm]?)[ \t]*$/m.exec(config ?? "");
  if (!match) return DEFAULT_STREAM_MAX;
  const unit = { "": 1, k: 1024, m: 1024 * 1024 }[match[2].toLowerCase()];
  const bytes = Number(match[1]) * unit;
  return bytes > 0 ? bytes : DEFAULT_STREAM_MAX;
}

/** Starts the filter; resolves with the listening server. */
export function startFilter({ listen, upstream, maxStream = DEFAULT_STREAM_MAX }) {
  let open = 0;
  // Half-open: a client that ends its side after the command (socat in tavora-api-clamav status) still gets clamd's reply.
  const server = net.createServer({ allowHalfOpen: true }, (client) => {
    if (open >= MAX_CONNECTIONS) {
      client.destroy();
      return;
    }
    open++;
    handle(client, upstream, maxStream, () => open--);
  });
  if (process.platform !== "win32") rmSync(listen, { force: true });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listen, () => {
      // Only the owner and the group (tavora-api, from the unit's Group=) may connect.
      if (process.platform !== "win32") chmodSync(listen, 0o660);
      resolve(server);
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [listen, upstream, conf] = process.argv.slice(2);
  if (!listen || !upstream) {
    console.error("Usage: node tavora-clamd-filter.mjs <listen socket> <clamd socket> [clamd.conf]");
    process.exit(2);
  }
  let config = "";
  try {
    config = conf ? readFileSync(conf, "utf8") : "";
  } catch {
    console.log(`clamd filter: can't read ${conf}, using clamd's default stream limit`);
  }
  const maxStream = streamLimit(config);
  await startFilter({ listen, upstream, maxStream });
  console.log(`clamd filter: ${listen} -> ${upstream} (INSTREAM up to ${maxStream} bytes, PING and VERSION only)`);
}
