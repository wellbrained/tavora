import { fingerprint, publicKeyFromRaw, readZipEntry, SIGNATURE_FILE, zipDirectory } from "@tavora/pack";

/**
 * Module zips are checked in memory, whole and unpacked, and a check can last minutes (the virus scan), under the service's
 * 256 MB limit (deploy/tavora-api.service). So what uploads hold at once is counted here, from each zip's directory before
 * anything is unpacked: an upload that doesn't fit now is asked to try again, and one that could never fit is refused.
 * Raising this means raising MemoryMax with it.
 */
export const UPLOAD_MEMORY_BYTES = 128 * 1024 * 1024;

/** Memory held for one upload until `release`. */
export interface MemoryTicket {
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

/**
 * The key a zip says signed it, read without unpacking its other files; null when that can't be told. Only a claim: it decides
 * whether the zip is worth unpacking, and checkCatalogZip then verifies the signature over every file.
 */
export function claimedSigner(bytes: Buffer): string | null {
  try {
    const data = readZipEntry(bytes, SIGNATURE_FILE);
    const publicKey = data ? (JSON.parse(data.toString("utf8")) as { publicKey?: unknown }).publicKey : null;
    const key = typeof publicKey === "string" ? publicKeyFromRaw(publicKey) : null;
    return key ? fingerprint(key) : null;
  } catch {
    return null;
  }
}

/** What checking a zip holds in memory: the zip and every file unpacked, by its directory. Null when the directory can't be read. */
export function zipMemory(zip: Buffer): number | null {
  try {
    return zipDirectory(zip).reduce((sum, file) => sum + file.size, zip.length);
  } catch {
    return null;
  }
}
