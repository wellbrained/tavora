import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { UPLOAD_BUDGET_BYTES } from "@tavora/module-schema";
import { fingerprint, MANIFEST_FILE, PUBLISH_MIN_BYTES_PER_SECOND, PUBLISH_READ_GRACE_MS, publicKeyFromRaw, readZipEntry, SIGNATURE_FILE, zipDirectory } from "@tavora/pack";

/**
 * Module zips are checked in memory, whole and unpacked, and a check can last minutes (the virus scan), under the service's
 * 256 MB limit (deploy/tavora-api.service). So what uploads hold at once is counted here, from each zip's directory before
 * anything is unpacked: an upload that doesn't fit now is asked to try again, and one that could never fit is refused.
 * The service itself takes about 100 MB and a check holds about a third more than this counts (hashes, text, garbage not yet
 * collected), which is what this leaves room for: measured under a real 256 MB cgroup limit from a 96 MB base. Raising this
 * means raising MemoryMax with it. tavora-pack and the app check it before an upload (UPLOAD_BUDGET_BYTES in module-schema).
 */
export const UPLOAD_MEMORY_BYTES = UPLOAD_BUDGET_BYTES;

/** After holding at least this much, memory is handed back at once instead of whenever the collector gets to it. */
export const FREE_AFTER_BYTES = 16 * 1024 * 1024;

let collect: (() => void) | undefined;

/** Runs a full garbage collection, so the big buffers of a finished zip are gone before the next one is read. */
export function freeMemory(): void {
  try {
    if (!collect) {
      setFlagsFromString("--expose-gc");
      collect = runInNewContext("gc") as () => void;
      setFlagsFromString("--no-expose-gc");
    }
    collect();
  } catch {
    // Only a help: the collector still runs by itself, and no upload may fail over this.
  }
}

/**
 * The biggest manifest, changelog and signature file the catalog reads. They are held as bytes, as text and as parsed JSON, which
 * together take several times their size, so they are capped from the zip's directory before any of them is unpacked. The
 * signature's cap fits a zip of the most files with the longest names.
 */
export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

/** How long an upload may send nothing while it holds memory. */
export const UPLOAD_IDLE_MS = 30_000;

/** Memory held for one upload until `release`. */
export interface MemoryTicket {
  /** What it holds now. */
  readonly held: number;
  /** Holds `bytes` instead of what it held; false, with nothing changed, when that doesn't fit. */
  resize(bytes: number): boolean;
  release(): void;
}

export interface UploadMemory {
  readonly budget: number;
  /** Holds `bytes`, or null when they don't fit right now. */
  take(bytes: number): MemoryTicket | null;
}

export function createUploadMemory(budget = UPLOAD_MEMORY_BYTES): UploadMemory {
  let used = 0;
  return {
    budget,
    take(bytes) {
      if (used + bytes > budget) return null;
      used += bytes;
      let held = bytes;
      return {
        get held() {
          return held;
        },
        resize(next) {
          if (used - held + next > budget) return false;
          used += next - held;
          held = next;
          return true;
        },
        release() {
          used -= held;
          held = 0;
        },
      };
    },
  };
}

/** The one budget of this process: uploads and the maintainer's run over live modules share it. */
export const uploadMemory = createUploadMemory();

export type BodyRead = { bytes: Buffer } | { refused: "too-big" | "too-slow" };

/** How patient readUpload is; the defaults are the catalog's. */
export interface ReadLimits {
  idleMs?: number;
  graceMs?: number;
  bytesPerSecond?: number;
}

/**
 * Reads a request's body into one buffer of at most `maxBytes`, which the caller already holds a ticket for. It stops at the
 * first byte past the limit, when nothing arrives for `idleMs`, and when it falls behind: after `graceMs`, what has arrived must
 * keep up with `bytesPerSecond`. So a bigger upload gets longer on a slow honest line, and a trickle can't hold memory for long.
 * It then cancels the body.
 */
export async function readUpload(
  request: Request,
  maxBytes: number,
  { idleMs = UPLOAD_IDLE_MS, graceMs = PUBLISH_READ_GRACE_MS, bytesPerSecond = PUBLISH_MIN_BYTES_PER_SECOND }: ReadLimits = {},
): Promise<BodyRead> {
  if (!request.body) return { bytes: Buffer.alloc(0) };
  const reader = request.body.getReader();
  const started = Date.now();
  // One block of the size the ticket counts: growing one would hold two copies for a moment.
  const out = Buffer.allocUnsafeSlow(maxBytes);
  let length = 0;
  try {
    for (;;) {
      const deadline = started + graceMs + (length / bytesPerSecond) * 1000;
      const wait = Math.min(idleMs, deadline - Date.now());
      if (wait <= 0) return { refused: "too-slow" };
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), wait)));
      const next = await Promise.race([reader.read(), late]).finally(() => clearTimeout(timer));
      if (next === "late") return { refused: "too-slow" };
      if (next.done) return { bytes: fitted(out, length) };
      if (length + next.value.length > maxBytes) return { refused: "too-big" };
      out.set(next.value, length);
      length += next.value.length;
    }
  } catch {
    // The connection went away mid-upload.
    return { refused: "too-slow" };
  } finally {
    void reader.cancel().catch(() => {});
  }
}

/**
 * The first `length` bytes of a read block. A body that ended well short of its block (one sent without a Content-Length
 * gets the biggest) is copied into a block of its own, so the big one is garbage at once and a ticket shrunk to the body
 * holds what is really kept (audit run 2). A longer one stays a view, as copying it would hold nearly two blocks for a
 * moment; heldBytes still counts its whole block.
 */
function fitted(block: Buffer, length: number): Buffer {
  if (length === block.length) return block;
  if (length > block.length / 2) return block.subarray(0, length);
  const own = Buffer.allocUnsafeSlow(length);
  block.copy(own, 0, 0, length);
  return own;
}

/** What a buffer really keeps alive: the whole block behind it, which can be more than the bytes it shows. */
export function heldBytes(bytes: Buffer): number {
  return Math.max(bytes.length, bytes.buffer.byteLength);
}

/** Why a zip's manifest or signature file is too big to read, by its directory; null when they fit. */
export function metadataProblem(directory: readonly { name: string; size: number }[]): string | null {
  for (const [name, limit] of [[MANIFEST_FILE, MAX_MANIFEST_BYTES], [SIGNATURE_FILE, MAX_SIGNATURE_BYTES]] as const) {
    if ((directory.find((file) => file.name === name)?.size ?? 0) > limit) return `Its ${name} is too big.`;
  }
  return null;
}

/** What a zip's directory says before anything but its signature file is unpacked. */
export interface ZipPlan {
  /** What checking it holds in memory: the zip and every file unpacked. */
  needed: number;
  /** Why it is refused without unpacking it; null when it may go on. */
  problem: string | null;
  /** The key it says signed it, set when `problem` is null. Only a claim: checkCatalogZip verifies the signature over every file. */
  signer: string | null;
}

/** Reads a zip's plan from its directory; null when the directory can't be read (checkCatalogZip then refuses it, unpacking nothing). */
export function zipPlan(zip: Buffer): ZipPlan | null {
  let directory: { name: string; size: number }[];
  try {
    directory = zipDirectory(zip);
  } catch {
    return null;
  }
  const needed = directory.reduce((sum, file) => sum + file.size, zip.length);
  const refuse = (problem: string): ZipPlan => ({ needed, problem, signer: null });
  const tooBig = metadataProblem(directory);
  if (tooBig) return refuse(tooBig);
  if (!directory.some((file) => file.name === MANIFEST_FILE)) return refuse(`It has no ${MANIFEST_FILE}.`);
  if (!directory.some((file) => file.name === SIGNATURE_FILE)) return refuse("It is not signed. Pack it with tavora-pack, which signs it with your publisher key.");
  try {
    const data = readZipEntry(zip, SIGNATURE_FILE);
    const publicKey = data ? (JSON.parse(data.toString("utf8")) as { publicKey?: unknown }).publicKey : null;
    const key = typeof publicKey === "string" ? publicKeyFromRaw(publicKey) : null;
    if (key) return { needed, problem: null, signer: fingerprint(key) };
  } catch {
    // Said below.
  }
  return refuse("It was refused: its signature file cannot be read.");
}

/** What checking a zip holds in memory: the zip and every file unpacked, by its directory. Null when the directory can't be read. */
export function zipMemory(zip: Buffer): number | null {
  try {
    return zipDirectory(zip).reduce((sum, file) => sum + file.size, zip.length);
  } catch {
    return null;
  }
}
