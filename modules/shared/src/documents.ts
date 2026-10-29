// Saving documents that several panels of a module edit at once.
// Deprecated: `openDocument` from `@tavora/sdk/store` (or `useDocument`) does this and more; these stay until the last caller has moved.

import { TavoraError, type JsonValue, type TavoraSDK } from "@tavora/sdk";

export interface Versioned<T> {
  data: T;
  /** 0 while the document does not exist yet. */
  revision: number;
}

export interface UpdateOptions<T> {
  /** Turns stored data, or null for a missing document, into a valid value. */
  parse(raw: JsonValue | null): T;
  /** Changes a copy of the newest data in place, or returns a replacement. */
  change(data: T): T | void;
  title(data: T): string;
  /** The copy this panel last saw, to skip a read when nothing changed since. */
  known?: Versioned<T> | undefined;
}

/** How often a change is re-applied when other panels keep saving first. */
const MAX_ATTEMPTS = 5;

/**
 * @deprecated Use `openDocument` from `@tavora/sdk/store` (or `useDocument`).
 *
 * Saves a change to a document that several panels may edit at once. The
 * change is applied to the newest stored copy; when another panel saved in
 * between, the document is read again and the change applied once more, so
 * neither panel's edit is lost.
 */
export async function updateDocument<T extends JsonValue>(
  sdk: TavoraSDK,
  id: string,
  options: UpdateOptions<T>,
): Promise<Versioned<T> & { updatedAt: string }> {
  let current = options.known ?? (await readDocument(sdk, id, options.parse));
  for (let attempt = 1; ; attempt++) {
    const copy = structuredClone(current.data);
    const data = options.change(copy) ?? copy;
    try {
      const saved = await sdk.documents.put({ id, title: options.title(data), data, ifRevision: current.revision });
      return { data, revision: saved.revision, updatedAt: saved.updatedAt };
    } catch (error) {
      if (!(error instanceof TavoraError) || error.code !== "CONFLICT" || attempt >= MAX_ATTEMPTS) throw error;
      current = await readDocument(sdk, id, options.parse);
    }
  }
}

/** @deprecated Use `openDocument` from `@tavora/sdk/store` (or `useDocument`). */
export async function readDocument<T>(sdk: TavoraSDK, id: string, parse: (raw: JsonValue | null) => T): Promise<Versioned<T>> {
  const doc = await sdk.documents.get(id);
  return doc ? { data: parse(doc.data), revision: doc.revision } : { data: parse(null), revision: 0 };
}

/**
 * @deprecated The document store saves one after another by itself.
 *
 * Runs async jobs one after another, so saves from one panel never overlap.
 */
export function serial(): <R>(job: () => Promise<R>) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (job) => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
