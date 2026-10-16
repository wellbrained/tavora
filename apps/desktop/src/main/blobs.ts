// Files (pictures) a module keeps for one game: one folder per module and game, files named by
// the host (32 hex characters and an extension from what the file turned out to be). A module
// never gives a name or a path; it gets an id back. Reading and writing go through the module's
// own address (see module-view.ts), so a file is never held in memory whole.

import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { BLOB_ID, LIMITS, type BlobInfo, type BlobType, type BlobUsage } from "@tavora/sdk/protocol";
import { HostError } from "./errors";
import { SerialQueue } from "./fsutil";

const EXTENSIONS: Record<BlobType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const TYPE_BY_EXTENSION = new Map(Object.entries(EXTENSIONS).map(([type, extension]) => [extension, type as BlobType]));

/** What a file is, judged by its first bytes and nothing the module says. Null for any other kind of file. */
export function sniffType(head: Uint8Array): BlobType | null {
  const is = (offset: number, bytes: number[]) => bytes.every((byte, index) => head[offset + index] === byte);
  if (is(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (is(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (is(0, [0x47, 0x49, 0x46, 0x38]) && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61) return "image/gif";
  if (is(0, [0x52, 0x49, 0x46, 0x46]) && is(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

export interface BlobLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const BLOB_LIMITS: BlobLimits = { maxFileBytes: LIMITS.maxBlobBytes, maxTotalBytes: LIMITS.maxBlobsBytes };

/** Enough of a file to tell its kind. */
const HEAD_BYTES = 16;

export class BlobStore {
  private readonly queue = new SerialQueue();

  /** `dir` is asked for each time, so the folder can be moved while Tavora runs. */
  constructor(
    private readonly dir: () => string,
    private readonly limits: BlobLimits = BLOB_LIMITS,
    /** True while the files are being moved to another folder, when nothing new may be added. */
    private readonly locked: () => boolean = () => false,
  ) {}

  list(): Promise<BlobInfo[]> {
    return this.queue.run(() => this.scan());
  }

  usage(): Promise<BlobUsage> {
    return this.queue.run(async () => {
      const files = await this.scan();
      return {
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        count: files.length,
        maxBytes: this.limits.maxTotalBytes,
        maxFileBytes: this.limits.maxFileBytes,
      };
    });
  }

  /**
   * Stores what the stream delivers. Refused, with nothing left behind, when it is empty, larger than
   * one file may be, would take the module past its total, or is not a picture of a kind we accept.
   */
  put(body: AsyncIterable<Uint8Array>, declaredBytes?: number): Promise<BlobInfo> {
    if (this.locked()) return Promise.reject(new HostError("INTERNAL", "pictures are being moved to another folder; try again in a moment"));
    if (declaredBytes !== undefined && declaredBytes > this.limits.maxFileBytes) {
      return Promise.reject(this.tooLarge());
    }
    return this.queue.run(async () => {
      const used = (await this.scan()).reduce((sum, file) => sum + file.bytes, 0);
      const room = Math.min(this.limits.maxFileBytes, this.limits.maxTotalBytes - used);
      if (room <= 0) throw this.tooMuch();
      const dir = this.dir();
      await mkdir(dir, { recursive: true });

      const id = randomBytes(16).toString("hex");
      const temp = path.join(dir, `${id}.tmp`);
      const handle = await open(temp, "wx");
      let written = 0;
      let type: BlobType | null = null;
      const head: number[] = [];
      try {
        for await (const chunk of body) {
          written += chunk.byteLength;
          if (written > room) throw written > this.limits.maxFileBytes ? this.tooLarge() : this.tooMuch();
          for (let index = 0; head.length < HEAD_BYTES && index < chunk.byteLength; index++) head.push(chunk[index]!);
          if (type === null && head.length >= HEAD_BYTES) {
            type = sniffType(Uint8Array.from(head));
            if (type === null) throw this.notAccepted();
          }
          await handle.write(chunk);
        }
        // A file shorter than the head is checked at the end.
        type ??= sniffType(Uint8Array.from(head));
        if (written === 0 || type === null) throw this.notAccepted();
        await handle.close();
        const name = `${id}.${EXTENSIONS[type]}`;
        await rename(temp, path.join(dir, name));
        const info = await stat(path.join(dir, name));
        return { id, bytes: written, type, createdAt: info.birthtime.toISOString() };
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(temp, { force: true });
        throw error;
      }
    });
  }

  /** Removes a file; a missing one is not an error. An id that is not one of ours is refused. */
  delete(id: unknown): Promise<void> {
    const valid = this.validId(id);
    return this.queue.run(async () => {
      const found = await this.find(valid);
      if (found) await rm(found.file, { force: true });
    });
  }

  /** Where a file is and what it is, for serving it. Null when there is no such file. */
  open(id: unknown): Promise<{ file: string; type: BlobType; bytes: number } | null> {
    if (typeof id !== "string" || !BLOB_ID.test(id)) return Promise.resolve(null);
    return this.queue.run(() => this.find(id));
  }

  private validId(id: unknown): string {
    if (typeof id !== "string" || !BLOB_ID.test(id)) throw new HostError("INVALID_PARAMS", "id must be the id of a stored file");
    return id;
  }

  private async find(id: string): Promise<{ file: string; type: BlobType; bytes: number } | null> {
    const dir = this.dir();
    for (const [extension, type] of TYPE_BY_EXTENSION) {
      const file = path.join(dir, `${id}.${extension}`);
      try {
        const info = await stat(file);
        if (info.isFile()) return { file, type, bytes: info.size };
      } catch {
        // Not this extension.
      }
    }
    return null;
  }

  private async scan(): Promise<BlobInfo[]> {
    const dir = this.dir();
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const files: BlobInfo[] = [];
    for (const name of names) {
      // Everything is stored one at a time, so a leftover temp file is from a write that was cut off.
      if (name.endsWith(".tmp")) {
        await rm(path.join(dir, name), { force: true });
        continue;
      }
      const match = /^([a-f0-9]{32})\.(png|jpg|gif|webp)$/.exec(name);
      if (!match) continue;
      try {
        const info = await stat(path.join(dir, name));
        if (info.isFile()) files.push({ id: match[1]!, bytes: info.size, type: TYPE_BY_EXTENSION.get(match[2]!)!, createdAt: info.birthtime.toISOString() });
      } catch {
        // Removed while we looked.
      }
    }
    return files.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  private tooLarge(): HostError {
    return new HostError("QUOTA_EXCEEDED", `a file can be at most ${this.limits.maxFileBytes} bytes`);
  }

  private tooMuch(): HostError {
    return new HostError("QUOTA_EXCEEDED", `files are limited to ${this.limits.maxTotalBytes} bytes per module and game`);
  }

  private notAccepted(): HostError {
    return new HostError("INVALID_PARAMS", "only PNG, JPEG, GIF and WebP pictures can be stored");
  }
}
