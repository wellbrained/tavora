import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ZipFile } from "@tavora/pack";

/**
 * The virus scan of a new version (check 5 of moderation.ts), by ClamAV on the server: through clamd (a socket or a local
 * port) or, where there is no daemon, through the clamscan command. Whatever goes wrong (not installed, not answering, an error
 * reply, too slow) throws, and a version whose scan threw waits for a person: a scan that did not run is never a clean one.
 */

export type ScanResult = { clean: true } | { clean: false; threats: string[] };

export interface Scanner {
  /**
   * Scans a zip and the files in it. Resolves clean only when every part was scanned and none was infected; throws when it could
   * not scan. Once `signal` aborts it starts nothing more, ends what is running and throws; it settles only when nothing runs.
   */
  scan(zip: Buffer, files: readonly ZipFile[], signal?: AbortSignal): Promise<ScanResult>;
}

/** What clamd says about one stream: `stream: OK`, `stream: <name> FOUND`; anything else is an error, and throws. */
export function parseClamdReply(reply: string): string | null {
  const text = reply.replace(/\0+$/, "").trim();
  if (/^stream: OK$/.test(text)) return null;
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found) return found[1]!;
  throw new Error(`clamd answered: ${text.slice(0, 120) || "nothing"}`);
}

export interface ClamdTarget {
  /** Path of clamd's unix socket, such as /run/clamav/clamd.ctl. */
  socket?: string;
  host?: string;
  port?: number;
}

const CHUNK = 64 * 1024;
/** The biggest thing sent to clamd as one stream (its StreamMaxLength is 25 MB by default). */
const MAX_STREAM = 20 * 1024 * 1024;
/**
 * Extra time a stream gets per MB: clamd unpacks a zip and scans every file in it, which took 53 s for a fresh 13.6 MB module
 * zip of 817 files on the 2-core server (2026-10-27), so a fixed limit held every big zip as "not answered in time".
 */
const MS_PER_MB = 5_000;

/** Sends bytes to clamd as one INSTREAM and returns the threat's name, or null when it is clean. */
export function clamdScan(target: ClamdTarget, data: Buffer, timeoutMs: number, signal?: AbortSignal): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("the scan was stopped"));
      return;
    }
    const socket = target.socket ? net.createConnection({ path: target.socket }) : net.createConnection({ host: target.host ?? "127.0.0.1", port: target.port ?? 3310 });
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stopped);
      socket.destroy();
      action();
    };
    const stopped = () => done(() => reject(new Error("the scan was stopped")));
    signal?.addEventListener("abort", stopped, { once: true });
    const timer = setTimeout(() => done(() => reject(new Error("clamd did not answer in time"))), timeoutMs);
    socket.on("error", (error) => done(() => reject(new Error(`clamd is not reachable: ${error.message}`))));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      if (chunk.includes(0)) finish();
    });
    socket.on("end", finish);
    socket.on("close", finish);
    function finish() {
      if (settled) return;
      const reply = Buffer.concat(chunks).toString("utf8");
      done(() => {
        try {
          resolve(parseClamdReply(reply));
        } catch (error) {
          reject(error);
        }
      });
    }
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let at = 0; at < data.length; at += CHUNK) {
        const part = data.subarray(at, at + CHUNK);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(part.length);
        socket.write(length);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

/**
 * Runs `work` over items, at most `limit` at a time. The first failure, or `signal`, stops it: nothing more starts, what runs is
 * told to stop through the signal it gets, and only when all of it has ended does this throw that failure.
 */
async function pool<T>(items: readonly T[], limit: number, signal: AbortSignal | undefined, work: (item: T, signal: AbortSignal) => Promise<void>): Promise<void> {
  const stop = new AbortController();
  const stopped = () => stop.abort();
  if (signal?.aborted) stop.abort();
  else signal?.addEventListener("abort", stopped, { once: true });
  let next = 0;
  let failed = false;
  let failure: unknown;
  const run = async () => {
    while (!stop.signal.aborted && next < items.length) {
      try {
        await work(items[next++]!, stop.signal);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
        stop.abort();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  signal?.removeEventListener("abort", stopped);
  if (failed) throw failure;
  if (signal?.aborted) throw new Error("the scan was stopped");
}

/** Scans through clamd: the zip itself, then every file in it on its own. Each stream gets `timeoutMs` plus time for its size. */
export function createClamdScanner(target: ClamdTarget, options: { timeoutMs?: number } = {}): Scanner {
  const timeoutMs = options.timeoutMs ?? 30_000;
  return {
    async scan(zip, files, signal) {
      const threats: string[] = [];
      const parts: { label: string; data: Buffer }[] = [];
      if (zip.length <= MAX_STREAM) parts.push({ label: "the zip", data: zip });
      for (const file of files) {
        if (file.data.length === 0) continue;
        // A file clamd cannot take whole cannot be called scanned.
        if (file.data.length > MAX_STREAM) throw new Error(`${file.name} is too big to scan`);
        parts.push({ label: file.name, data: file.data });
      }
      await pool(parts, 4, signal, async ({ label, data }, stop) => {
        const threat = await clamdScan(target, data, timeoutMs + Math.ceil((data.length / (1024 * 1024)) * MS_PER_MB), stop);
        if (threat !== null) threats.push(`${threat} in ${label}`);
      });
      return threats.length === 0 ? { clean: true } : { clean: false, threats };
    },
  };
}

/**
 * Scans through the clamscan command (no daemon): the files are written to a folder of their own, scanned in one run, and the folder
 * removed. Exit 0 is clean, 1 is infected, anything else is an error.
 */
export function createClamscanScanner(options: { command?: string; args?: string[]; timeoutMs?: number } = {}): Scanner {
  const command = options.command ?? "clamscan";
  const timeoutMs = options.timeoutMs ?? 120_000;
  return {
    async scan(zip, files, signal) {
      const dir = await mkdtemp(path.join(tmpdir(), "tavora-scan-"));
      try {
        const names = new Map<string, string>();
        signal?.throwIfAborted();
        await writeFile(path.join(dir, "zip.bin"), zip, signal ? { signal } : {});
        names.set("zip.bin", "the zip");
        for (const [index, file] of files.entries()) {
          signal?.throwIfAborted();
          // Named by number, never by what the zip calls it.
          const name = `f${index}.bin`;
          names.set(name, file.name);
          await writeFile(path.join(dir, name), file.data, signal ? { signal } : {});
        }
        signal?.throwIfAborted();
        const output = await new Promise<{ code: number | null; out: string }>((resolve, reject) => {
          const child = spawn(command, [...(options.args ?? []), "--no-summary", "-r", dir], { stdio: ["ignore", "pipe", "pipe"] });
          let out = "";
          // Both ways of ending it wait for the process to be gone, so the folder is removed after it and nothing runs on.
          let ended: Error | null = null;
          const end = (error: Error) => {
            ended ??= error;
            child.kill("SIGKILL");
          };
          const stopped = () => end(new Error("the scan was stopped"));
          const timer = setTimeout(() => end(new Error("clamscan did not finish in time")), timeoutMs);
          signal?.addEventListener("abort", stopped, { once: true });
          const finished = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", stopped);
          };
          child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
          child.on("error", (error) => {
            finished();
            reject(ended ?? new Error(`clamscan could not run: ${error.message}`));
          });
          child.on("close", (code) => {
            finished();
            if (ended) reject(ended);
            else resolve({ code, out });
          });
        });
        if (output.code === 0) return { clean: true };
        if (output.code !== 1) throw new Error(`clamscan exited with ${output.code}`);
        const threats = output.out
          .split("\n")
          .map((line) => /^(.*): (.+) FOUND$/.exec(line.trim()))
          .filter((match): match is RegExpExecArray => match !== null)
          .map((match) => `${match[2]} in ${names.get(path.basename(match[1]!)) ?? "a file"}`);
        // Exit 1 without a FOUND line we can read is still not clean.
        return { clean: false, threats: threats.length > 0 ? threats : ["something (clamscan reported an infection)"] };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * The scanner the server is set up for, or undefined (every version then waits). CLAMD_SOCKET or CLAMD_HOST (with CLAMD_PORT, 3310
 * by default) use clamd; CLAMSCAN_PATH uses the clamscan command.
 */
export function scannerFromEnv(env: NodeJS.ProcessEnv): Scanner | undefined {
  const socket = env.CLAMD_SOCKET?.trim();
  if (socket) return createClamdScanner({ socket });
  const host = env.CLAMD_HOST?.trim();
  if (host) {
    const port = Number(env.CLAMD_PORT ?? 3310);
    return createClamdScanner({ host, port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3310 });
  }
  const command = env.CLAMSCAN_PATH?.trim();
  return command ? createClamscanScanner({ command }) : undefined;
}
