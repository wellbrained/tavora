import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  DOCUMENT_ID,
  LIMITS,
  type DocumentChange,
  type DocumentSummary,
  type JsonValue,
  type PutDocumentParams,
  type TavoraDocument,
} from "@tavora/sdk/protocol";
import { HostError } from "./errors";
import { SerialQueue, writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside, serializeJson } from "./json";

interface StoredDocument {
  version: 1;
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  data: JsonValue;
}

interface Index {
  version: 1;
  documents: Record<string, DocumentSummary>;
}

export interface DocumentLimits {
  maxDocumentBytes: number;
  maxDocumentsBytes: number;
  maxDocuments: number;
}

/**
 * Named documents for one module in one workspace, one file each. A small index
 * makes listing cheap; it is rebuilt from the document files whenever it is
 * missing or older than any of them, so a crash between the two writes
 * never loses a change.
 *
 * Emits "change" with (change, origin) so other panels can refresh.
 */
export class DocumentStore extends EventEmitter<{ change: [DocumentChange, unknown] }> {
  private index: Map<string, DocumentSummary> | undefined;
  private readonly queue = new SerialQueue();

  constructor(
    readonly dir: string,
    private readonly limits: DocumentLimits = LIMITS,
  ) {
    super();
  }

  list(): Promise<DocumentSummary[]> {
    return this.queue.run(async () =>
      [...(await this.load()).values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }

  async get(id: unknown): Promise<TavoraDocument | null> {
    const docId = validateId(id);
    return this.queue.run(async () => {
      if (!(await this.load()).has(docId)) return null;
      const stored = await readJsonOrSetAside<StoredDocument>(this.file(docId));
      if (!stored) return null;
      const { version: _version, ...document } = stored;
      return { ...document, bytes: Buffer.byteLength(JSON.stringify(stored.data)) };
    });
  }

  async put(params: unknown, origin?: unknown): Promise<DocumentSummary> {
    if (typeof params !== "object" || params === null) throw new HostError("INVALID_PARAMS", "params must be an object");
    const { id, title, data, ifRevision } = params as Partial<PutDocumentParams>;
    const docId = id === undefined ? randomUUID() : validateId(id);
    if (typeof title !== "string" || title.length > LIMITS.maxTitleLength) {
      throw new HostError("INVALID_PARAMS", `title must be a string of at most ${LIMITS.maxTitleLength} characters`);
    }
    if (!("data" in params)) throw new HostError("INVALID_PARAMS", "data is required");
    const serialized = serializeJson(data, "data");
    const bytes = Buffer.byteLength(serialized);
    if (bytes > this.limits.maxDocumentBytes) {
      throw new HostError("QUOTA_EXCEEDED", `a document is limited to ${this.limits.maxDocumentBytes} bytes`);
    }
    if (ifRevision !== undefined && !Number.isSafeInteger(ifRevision)) {
      throw new HostError("INVALID_PARAMS", "ifRevision must be an integer");
    }

    return this.queue.run(async () => {
      const index = await this.load();
      const existing = index.get(docId);
      checkRevision(existing, ifRevision);
      if (!existing && index.size >= this.limits.maxDocuments) {
        throw new HostError("QUOTA_EXCEEDED", `a module may keep at most ${this.limits.maxDocuments} documents per workspace`);
      }
      const total = [...index.values()].reduce((sum, doc) => sum + doc.bytes, 0) - (existing?.bytes ?? 0) + bytes;
      if (total > this.limits.maxDocumentsBytes) {
        throw new HostError("QUOTA_EXCEEDED", `documents are limited to ${this.limits.maxDocumentsBytes} bytes per module and workspace`);
      }

      const summary: DocumentSummary = {
        id: docId,
        title,
        revision: (existing?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        bytes,
      };
      const { bytes: _bytes, ...meta } = summary;
      await writeFileAtomic(this.file(docId), `${JSON.stringify({ version: 1, ...meta }).slice(0, -1)},"data":${serialized}}`);
      index.set(docId, summary);
      await this.persistIndex(index);
      this.emit("change", { id: docId, revision: summary.revision, deleted: false }, origin);
      return summary;
    });
  }

  async delete(id: unknown, ifRevision?: unknown, origin?: unknown): Promise<void> {
    const docId = validateId(id);
    if (ifRevision !== undefined && !Number.isSafeInteger(ifRevision)) {
      throw new HostError("INVALID_PARAMS", "ifRevision must be an integer");
    }
    return this.queue.run(async () => {
      const index = await this.load();
      const existing = index.get(docId);
      if (!existing) return;
      checkRevision(existing, ifRevision as number | undefined);
      index.delete(docId);
      await this.persistIndex(index);
      await rm(this.file(docId), { force: true });
      this.emit("change", { id: docId, revision: existing.revision, deleted: true }, origin);
    });
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private get indexFile(): string {
    return path.join(this.dir, "index.json");
  }

  private async load(): Promise<Map<string, DocumentSummary>> {
    if (this.index) return this.index;
    const saved = await readJsonOrSetAside<Index>(this.indexFile);
    this.index =
      saved && typeof saved.documents === "object" && !(await this.newerThanIndex())
        ? new Map(Object.entries(saved.documents))
        : await this.rebuild();
    return this.index;
  }

  /** Whether any document file was written after the index. */
  private async newerThanIndex(): Promise<boolean> {
    const indexTime = (await stat(this.indexFile)).mtimeMs;
    for (const name of await this.documentFiles()) {
      if ((await stat(path.join(this.dir, name))).mtimeMs > indexTime) return true;
    }
    return false;
  }

  private async rebuild(): Promise<Map<string, DocumentSummary>> {
    const index = new Map<string, DocumentSummary>();
    for (const name of await this.documentFiles()) {
      const stored = await readJsonOrSetAside<StoredDocument>(path.join(this.dir, name));
      if (!stored || stored.id !== name.slice(0, -".json".length)) continue;
      index.set(stored.id, {
        id: stored.id,
        title: stored.title,
        revision: stored.revision,
        updatedAt: stored.updatedAt,
        bytes: Buffer.byteLength(JSON.stringify(stored.data)),
      });
    }
    if (index.size > 0) await this.persistIndex(index);
    return index;
  }

  private async documentFiles(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter(
        (name) => name.endsWith(".json") && name !== "index.json" && DOCUMENT_ID.test(name.slice(0, -".json".length)),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private persistIndex(index: Map<string, DocumentSummary>): Promise<void> {
    return writeFileAtomic(this.indexFile, JSON.stringify({ version: 1, documents: Object.fromEntries(index) }));
  }
}

function validateId(id: unknown): string {
  if (typeof id !== "string" || !DOCUMENT_ID.test(id)) {
    throw new HostError("INVALID_PARAMS", "document id must be 1 to 64 letters, digits, '-' or '_'");
  }
  return id;
}

function checkRevision(existing: DocumentSummary | undefined, ifRevision: number | undefined): void {
  if (ifRevision === undefined) return;
  const current = existing?.revision ?? 0;
  if (current !== ifRevision) {
    throw new HostError("CONFLICT", `document is at revision ${current}, not ${ifRevision}`, { revision: current });
  }
}
