import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { isModuleId, isOwnerId } from "@tavora/module-schema";
import { LIMITS, type JsonValue } from "@tavora/sdk/protocol";
import { BlobStore } from "./blobs";
import { DocumentStore } from "./documents";
import { HostError } from "./errors";
import { SerialQueue, writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside, serializeJson } from "./json";
import { INSTANCE_ID } from "./ids";
import { isWorkspaceId } from "./workspace-id";
import { defaultFilesRoot } from "./module-files";

export { isJsonValue } from "./json";

export function validateKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0 || key.length > LIMITS.maxKeyLength) {
    throw new HostError("INVALID_PARAMS", `key must be a string of 1 to ${LIMITS.maxKeyLength} characters`);
  }
}

/**
 * Private key/value settings for one module in one workspace, or shared by all its
 * workspaces (storage.app). Values are kept serialized so the quota is measured on
 * exactly what is written to disk.
 */
export class ModuleStore {
  private entries: Map<string, string> | undefined;
  private bytes = 0;
  private readonly queue = new SerialQueue();

  constructor(
    readonly file: string,
    private readonly maxBytes: number = LIMITS.maxStoreBytes,
  ) {}

  get(key: unknown): Promise<JsonValue | null> {
    validateKey(key);
    return this.queue.run(async () => {
      const raw = (await this.load()).get(key);
      return raw === undefined ? null : (JSON.parse(raw) as JsonValue);
    });
  }

  keys(): Promise<string[]> {
    return this.queue.run(async () => [...(await this.load()).keys()].sort());
  }

  set(key: unknown, value: unknown): Promise<void> {
    validateKey(key);
    const serialized = serializeJson(value, "value");
    return this.queue.run(async () => {
      const entries = await this.load();
      const previous = entries.get(key);
      const next = this.bytes - (previous === undefined ? 0 : entrySize(key, previous)) + entrySize(key, serialized);
      if (next > this.maxBytes) {
        throw new HostError("QUOTA_EXCEEDED", `settings are limited to ${this.maxBytes} bytes per store`);
      }
      entries.set(key, serialized);
      this.bytes = next;
      await this.persist(entries);
    });
  }

  delete(key: unknown): Promise<void> {
    validateKey(key);
    return this.queue.run(async () => {
      const entries = await this.load();
      const previous = entries.get(key);
      if (previous === undefined) return;
      entries.delete(key);
      this.bytes -= entrySize(key, previous);
      await this.persist(entries);
    });
  }

  /**
   * Sets `value` only while the key holds `expected` (null: not set), in one step of the queue, so two panels can't
   * overwrite each other's change. Values are compared as JSON, whatever the order of their keys. Whether it was set.
   */
  compareAndSet(key: unknown, expected: unknown, value: unknown): Promise<boolean> {
    validateKey(key);
    const wanted = expected === null ? null : (JSON.parse(serializeJson(expected, "expected")) as JsonValue);
    const serialized = serializeJson(value, "value");
    return this.queue.run(async () => {
      const entries = await this.load();
      const previous = entries.get(key);
      const current = previous === undefined ? null : (JSON.parse(previous) as JsonValue);
      if (!sameJson(current, wanted)) return false;
      const before = this.bytes;
      const next = before - (previous === undefined ? 0 : entrySize(key, previous)) + entrySize(key, serialized);
      if (next > this.maxBytes) {
        throw new HostError("QUOTA_EXCEEDED", `settings are limited to ${this.maxBytes} bytes per store`);
      }
      entries.set(key, serialized);
      this.bytes = next;
      try {
        await this.persist(entries);
      } catch (error) {
        // Not written: the next compare must see what is on disk.
        if (previous === undefined) entries.delete(key);
        else entries.set(key, previous);
        this.bytes = before;
        throw error;
      }
      return true;
    });
  }

  private async load(): Promise<Map<string, string>> {
    if (this.entries) return this.entries;
    const entries = new Map<string, string>();
    const parsed = await readJsonOrSetAside<{ entries: Record<string, JsonValue> }>(this.file);
    if (parsed && typeof parsed.entries === "object" && parsed.entries !== null) {
      for (const [key, value] of Object.entries(parsed.entries)) entries.set(key, JSON.stringify(value));
    }
    this.bytes = [...entries].reduce((sum, [key, value]) => sum + entrySize(key, value), 0);
    this.entries = entries;
    return entries;
  }

  private persist(entries: Map<string, string>): Promise<void> {
    const body = `{"version":1,"entries":{${[...entries]
      .map(([key, value]) => `${JSON.stringify(key)}:${value}`)
      .join(",")}}}`;
    return writeFileAtomic(this.file, body);
  }
}

function entrySize(key: string, serialized: string): number {
  return Buffer.byteLength(key) + Buffer.byteLength(serialized);
}

/** Whether two JSON values hold the same, whatever the order of their objects' keys. */
function sameJson(a: JsonValue | null, b: JsonValue | null): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameJson(item, b[index]!));
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && sameJson(a[key]!, b[key]!));
}

/** UI state for one panel instance. Removed when the panel is closed. */
export class PanelStateStore {
  private readonly queue = new SerialQueue();

  constructor(private readonly dir: string) {}

  private file(instanceId: string): string {
    if (!INSTANCE_ID.test(instanceId)) throw new Error("invalid instance id");
    return path.join(this.dir, `${instanceId}.json`);
  }

  get(instanceId: string): Promise<JsonValue | null> {
    const file = this.file(instanceId);
    return this.queue.run(async () => (await readJsonOrSetAside<{ value: JsonValue }>(file))?.value ?? null);
  }

  set(instanceId: string, value: unknown): Promise<void> {
    const file = this.file(instanceId);
    if (value === null) return this.remove(instanceId);
    const serialized = serializeJson(value, "value");
    if (Buffer.byteLength(serialized) > LIMITS.maxPanelStateBytes) {
      throw new HostError("QUOTA_EXCEEDED", `panel state is limited to ${LIMITS.maxPanelStateBytes} bytes`);
    }
    return this.queue.run(() => writeFileAtomic(file, `{"version":1,"value":${serialized}}`));
  }

  remove(instanceId: string): Promise<void> {
    const file = this.file(instanceId);
    return this.queue.run(() => rm(file, { force: true }));
  }

  /** Deletes state files for panels that no longer exist in any workspace. */
  async prune(keep: Set<string>): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return;
    }
    await Promise.all(
      names
        .filter((name) => name.endsWith(".json") && !keep.has(name.slice(0, -".json".length)))
        .map((name) => this.queue.run(() => rm(path.join(this.dir, name), { force: true }))),
    );
  }
}

export interface ModuleData {
  settings: ModuleStore;
  documents: DocumentStore;
  /** Pictures kept in a folder of their own, which can sit elsewhere than the rest of the data. */
  blobs: BlobStore;
}

/**
 * The folder next to a module's workspace folders that holds its settings shared by every workspace
 * (storage.app). Workspace ids never start with "_", so it cannot be taken for a workspace.
 */
export const APP_DATA_DIR = "_app";

/** One settings store and one document store per (owner, module, workspace), shared by all its panels. */
export class DataRegistry {
  private readonly data = new Map<string, ModuleData>();
  private readonly app = new Map<string, ModuleStore>();
  readonly panelState: PanelStateStore;

  constructor(
    private readonly dataDir: string,
    /** The folder every module's files are kept under, by owner, module and workspace. */
    private readonly blobRoot: () => string = () => defaultFilesRoot(dataDir),
    /** True while that folder is being moved. */
    private readonly blobsLocked: () => boolean = () => false,
  ) {
    this.panelState = new PanelStateStore(path.join(dataDir, "panel-state"));
  }

  get(owner: string, moduleId: string, workspaceId: string): ModuleData {
    // Ids were validated when the module and workspace were registered; checking
    // again here keeps them from ever forming a path outside dataDir.
    if (!isOwnerId(owner) || !isModuleId(moduleId) || !isWorkspaceId(workspaceId)) throw new Error("invalid owner, module or workspace id");
    const dir = path.join(this.dataDir, "module-data", owner, moduleId, workspaceId);
    let data = this.data.get(dir);
    if (!data) {
      data = {
        settings: new ModuleStore(path.join(dir, "storage.json")),
        documents: new DocumentStore(path.join(dir, "documents")),
        blobs: new BlobStore(() => path.join(this.blobRoot(), owner, moduleId, workspaceId), undefined, this.blobsLocked),
      };
      this.data.set(dir, data);
    }
    return data;
  }

  /** The settings one owner's module shares across every workspace (storage.app), with the same limit as a workspace's. */
  appSettings(owner: string, moduleId: string): ModuleStore {
    if (!isOwnerId(owner) || !isModuleId(moduleId)) throw new Error("invalid owner or module id");
    const file = path.join(this.dataDir, "module-data", owner, moduleId, APP_DATA_DIR, "storage.json");
    let store = this.app.get(file);
    if (!store) this.app.set(file, (store = new ModuleStore(file)));
    return store;
  }

  /** Drops cached stores of one owner's module whose data is being deleted. */
  forgetModule(owner: string, moduleId: string): void {
    const prefix = path.join(this.dataDir, "module-data", owner, moduleId) + path.sep;
    for (const key of [...this.data.keys()]) {
      if (key.startsWith(prefix)) this.data.delete(key);
    }
    for (const key of [...this.app.keys()]) {
      if (key.startsWith(prefix)) this.app.delete(key);
    }
  }

  /** Drops cached stores for a workspace whose data is being deleted. */
  forgetWorkspace(workspaceId: string): void {
    for (const key of [...this.data.keys()]) {
      if (path.basename(key) === workspaceId) this.data.delete(key);
    }
  }
}
