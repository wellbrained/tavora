import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isGameId, isModuleId } from "@tavora/module-schema";
import { LIMITS, type JsonValue } from "@tavora/sdk/protocol";

export class StorageError extends Error {
  constructor(
    readonly code: "INVALID_PARAMS" | "QUOTA_EXCEEDED",
    message: string,
  ) {
    super(message);
  }
}

const MAX_DEPTH = 64;

/** Accepts only plain JSON data: no Dates, Maps, typed arrays, NaN or cycles. */
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value).every((item) => isJsonValue(item, depth + 1));
  }
  return false;
}

export function validateKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > LIMITS.maxKeyLength) {
    throw new StorageError("INVALID_PARAMS", `key must be a string of 1 to ${LIMITS.maxKeyLength} characters`);
  }
}

/**
 * Private key/value storage for one module in one game. Values are kept
 * serialized so the quota is measured on exactly what is written to disk.
 * Writes are serialized and atomic (write to a temp file, then rename).
 */
export class ModuleStore {
  private entries: Map<string, string> | undefined;
  private bytes = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly file: string,
    private readonly maxBytes: number = LIMITS.maxStoreBytes,
  ) {}

  get(key: unknown): Promise<JsonValue | null> {
    validateKey(key);
    return this.enqueue(async () => {
      const entries = await this.load();
      const raw = entries.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as JsonValue);
    });
  }

  set(key: unknown, value: unknown): Promise<void> {
    validateKey(key);
    if (!isJsonValue(value)) throw new StorageError("INVALID_PARAMS", "value must be plain JSON data");
    const serialized = JSON.stringify(value);
    return this.enqueue(async () => {
      const entries = await this.load();
      const previous = entries.get(key);
      const next = this.bytes - (previous === undefined ? 0 : entrySize(key, previous)) + entrySize(key, serialized);
      if (next > this.maxBytes) {
        throw new StorageError("QUOTA_EXCEEDED", `storage is limited to ${this.maxBytes} bytes per module and game`);
      }
      entries.set(key, serialized);
      this.bytes = next;
      await this.persist(entries);
    });
  }

  delete(key: unknown): Promise<void> {
    validateKey(key);
    return this.enqueue(async () => {
      const entries = await this.load();
      const previous = entries.get(key);
      if (previous === undefined) return;
      entries.delete(key);
      this.bytes -= entrySize(key, previous);
      await this.persist(entries);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<Map<string, string>> {
    if (this.entries) return this.entries;
    const entries = new Map<string, string>();
    let text: string | undefined;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (text !== undefined) {
      try {
        const parsed = JSON.parse(text) as { version: number; entries: Record<string, JsonValue> };
        for (const [key, value] of Object.entries(parsed.entries)) entries.set(key, JSON.stringify(value));
      } catch {
        // Keep the unreadable file for recovery instead of overwriting it.
        await rename(this.file, `${this.file}.corrupt-${Date.now()}`);
        console.error(`[tavora] storage file was unreadable and has been set aside: ${this.file}`);
        entries.clear();
      }
    }
    this.bytes = [...entries].reduce((sum, [key, value]) => sum + entrySize(key, value), 0);
    this.entries = entries;
    return entries;
  }

  private async persist(entries: Map<string, string>): Promise<void> {
    const body = `{"version":1,"entries":{${[...entries]
      .map(([key, value]) => `${JSON.stringify(key)}:${value}`)
      .join(",")}}}`;
    await mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, body, "utf8");
    await rename(temp, this.file);
  }
}

function entrySize(key: string, serialized: string): number {
  return Buffer.byteLength(key) + Buffer.byteLength(serialized);
}

/** One store per (module, game), shared by all panel instances of that module. */
export class StoreRegistry {
  private readonly stores = new Map<string, ModuleStore>();

  constructor(private readonly dataDir: string) {}

  get(moduleId: string, gameId: string): ModuleStore {
    // Ids were validated when the module and game were registered; checking
    // again here keeps them from ever forming a path outside dataDir.
    if (!isModuleId(moduleId) || !isGameId(gameId)) throw new Error("invalid module or game id");
    const file = path.join(this.dataDir, "module-data", moduleId, gameId, "storage.json");
    let store = this.stores.get(file);
    if (!store) this.stores.set(file, (store = new ModuleStore(file)));
    return store;
  }
}
