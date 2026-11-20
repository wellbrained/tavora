import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { isModuleId, isOwnerId } from "@tavora/module-schema";
import { LIMITS, type JsonValue } from "@tavora/sdk/protocol";
import { BlobStore } from "./blobs";
import { DocumentStore } from "./documents";
import { HostError } from "./errors";
import { SerialQueue, writeFileAtomic } from "./fsutil";
import { readSavedFile, serializeJson, unknownFields } from "./json";
import { STORE_VERSIONS } from "./saved-versions";
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
 * The fields of a saved file other than these, as JSON members to write back as they were (`"name":value,` each), so a
 * newer Tavora's fields survive this one's writes.
 */
function keptMembers(saved: unknown, known: readonly string[]): string {
  return Object.entries(unknownFields(saved, known))
    .map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)},`)
    .join("");
}

/**
 * Private key/value settings for one module in one workspace, or shared by all its
 * workspaces (storage.app). Values are kept serialized so the quota is measured on
 * exactly what is written to disk. Fields of the file other than the entries (a newer
 * Tavora's) are kept as they were; they don't count towards the quota.
 */
export class ModuleStore {
  private entries: Map<string, string> | undefined;
  /** The file's fields this Tavora doesn't know, ready to write back. */
  private kept = "";
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
    const parsed = (await readSavedFile(this.file, { version: STORE_VERSIONS.moduleSettings })) as { entries?: Record<string, JsonValue> } | null;
    if (parsed && typeof parsed.entries === "object" && parsed.entries !== null && !Array.isArray(parsed.entries)) {
      for (const [key, value] of Object.entries(parsed.entries)) entries.set(key, JSON.stringify(value));
    }
    this.kept = keptMembers(parsed, ["version", "entries"]);
    this.bytes = [...entries].reduce((sum, [key, value]) => sum + entrySize(key, value), 0);
    this.entries = entries;
    return entries;
  }

  private persist(entries: Map<string, string>): Promise<void> {
    const body = `{"version":${STORE_VERSIONS.moduleSettings},${this.kept}"entries":{${[...entries]
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

/** What a panel page reads and writes of its own state (panel.getState / panel.setState), as the owner it runs as. */
export interface PanelStateAccess {
  get(instanceId: string): Promise<JsonValue | null>;
  set(instanceId: string, value: unknown): Promise<void>;
}

/**
 * UI state for one panel instance. Removed when the panel is closed. Fields of its file other than the value (a newer
 * Tavora's) are kept. A module panel's state is kept with the owner (publisher) that wrote it: when the panel's module
 * id comes to load for another owner (a development folder over a catalog copy, also while the panel was closed or
 * Tavora was), that owner never reads it (handOver), and its writes never replace it: the first one moves the other
 * owner's file aside (`aside/<instanceId>.<owner tag>.json`, a folder older Tavoras' cleanup doesn't look into), where
 * that owner finds it again when the id comes back to it.
 */
export class PanelStateStore {
  private readonly queue = new SerialQueue();
  /** Panels handed over to another owner this run: writes of any other owner (the old page still saving) are dropped. */
  private readonly owners = new Map<string, string>();
  /**
   * Per panel file read this run, its fields this Tavora doesn't know, ready to write back: a newer Tavora's file is
   * copied aside, and read, before the first write only.
   */
  private readonly kept = new Map<string, string>();
  /** Per panel file read or written this run, the owner noted in it (null: none). */
  private readonly stamps = new Map<string, string | null>();

  constructor(private readonly dir: string) {}

  private file(instanceId: string): string {
    if (!INSTANCE_ID.test(instanceId)) throw new Error("invalid instance id");
    return path.join(this.dir, `${instanceId}.json`);
  }

  /** Where `owner`'s state of the panel waits while another owner's page runs in it. */
  private asideFile(instanceId: string, owner: string): string {
    if (!INSTANCE_ID.test(instanceId)) throw new Error("invalid instance id");
    return path.join(this.asideDir, `${instanceId}.${ownerTag(owner)}.json`);
  }

  private get asideDir(): string {
    return path.join(this.dir, ASIDE_FOLDER);
  }

  /**
   * The owner noted in a panel's state file, read at start before any page runs (a panel record from before owners
   * were noted takes it: workspace.ts noteOwners). Null when there is none.
   */
  async ownerOf(instanceId: string): Promise<string | null> {
    const file = this.file(instanceId);
    return this.queue.run(async () => {
      if (!this.stamps.has(file)) await this.read(file).catch(() => null);
      return this.stamps.get(file) ?? null;
    });
  }

  /** The panel's state; with `owner` (a module panel), only what that owner wrote (a file from before owners were noted counts). */
  get(instanceId: string, owner?: string): Promise<JsonValue | null> {
    const file = this.file(instanceId);
    return this.queue.run(async () => {
      const saved = await this.read(file);
      if (owner === undefined || typeof saved?.owner !== "string" || saved.owner === owner) return (saved?.value as JsonValue | undefined) ?? null;
      // Another owner's page ran in the panel last: this owner's own state, if it left any, waits aside.
      const aside = await readSavedFile(this.asideFile(instanceId, owner), { version: STORE_VERSIONS.panelState }).catch(() => null);
      return aside?.owner === owner ? ((aside.value as JsonValue | undefined) ?? null) : null;
    });
  }

  /**
   * The panel now runs as `to` (its module id loads for another owner): what `from` left stays `from`'s, so `to` reads
   * nothing of it, and what `from`'s closing page still writes is dropped. Queued after `from`'s writes so far.
   */
  handOver(instanceId: string, from: string, to: string): Promise<void> {
    const file = this.file(instanceId);
    this.owners.set(instanceId, to);
    return this.queue.run(async () => {
      const saved = await this.read(file);
      // A file from before owners were noted: it is `from`'s.
      if (!saved || typeof saved.owner === "string" || saved.value === undefined) return;
      await writeFileAtomic(file, `{"version":${STORE_VERSIONS.panelState},"owner":${JSON.stringify(from)},${this.kept.get(file) ?? ""}"value":${JSON.stringify(saved.value)}}`);
      this.stamps.set(file, from);
    });
  }

  /** The saved file of a panel: one a newer Tavora wrote is copied aside, an unreadable one set aside (readSavedFile). */
  private async read(file: string): Promise<Record<string, unknown> | null> {
    const saved = await readSavedFile(file, { version: STORE_VERSIONS.panelState });
    this.kept.set(file, keptMembers(saved, ["version", "owner", "value"]));
    this.stamps.set(file, typeof saved?.owner === "string" ? saved.owner : null);
    return saved;
  }

  /** Before `owner` writes: a file another owner noted as its own moves aside, kept for that owner. */
  private async moveAsideFor(instanceId: string, file: string, owner: string): Promise<void> {
    if (!this.stamps.has(file)) await this.read(file);
    const other = this.stamps.get(file);
    if (typeof other !== "string" || other === owner) return;
    await mkdir(this.asideDir, { recursive: true });
    await rename(file, this.asideFile(instanceId, other)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    this.kept.set(file, "");
    this.stamps.set(file, null);
  }

  /** With `owner` (a module panel), the state is noted as that owner's; dropped when the panel was handed to another. */
  set(instanceId: string, value: unknown, owner?: string): Promise<void> {
    const file = this.file(instanceId);
    const handed = this.owners.get(instanceId);
    if (owner !== undefined && handed !== undefined && handed !== owner) return Promise.resolve();
    if (value === null) return owner === undefined ? this.remove(instanceId) : this.clear(instanceId, owner);
    const serialized = serializeJson(value, "value");
    if (Buffer.byteLength(serialized) > LIMITS.maxPanelStateBytes) {
      throw new HostError("QUOTA_EXCEEDED", `panel state is limited to ${LIMITS.maxPanelStateBytes} bytes`);
    }
    return this.queue.run(async () => {
      // Read before it is first written over, so a newer Tavora's file is copied aside first and its fields are kept.
      if (!this.kept.has(file)) await this.read(file);
      if (owner !== undefined) await this.moveAsideFor(instanceId, file, owner);
      const kept = this.kept.get(file) ?? "";
      const stamp = owner === undefined ? "" : `"owner":${JSON.stringify(owner)},`;
      await writeFileAtomic(file, `{"version":${STORE_VERSIONS.panelState},${stamp}${kept}"value":${serialized}}`);
      this.stamps.set(file, owner ?? null);
    });
  }

  /** A module panel's page cleared its state: only `owner`'s goes; another owner's file stays as it is. */
  private clear(instanceId: string, owner: string): Promise<void> {
    const file = this.file(instanceId);
    const aside = this.asideFile(instanceId, owner);
    return this.queue.run(async () => {
      if (!this.stamps.has(file)) await this.read(file);
      const other = this.stamps.get(file);
      if (typeof other !== "string" || other === owner) {
        await rm(file, { force: true });
        this.kept.delete(file);
        this.stamps.delete(file);
      }
      await rm(aside, { force: true });
    });
  }

  /** The panel closed for good: its state goes, every owner's. */
  remove(instanceId: string): Promise<void> {
    const file = this.file(instanceId);
    return this.queue.run(async () => {
      await rm(file, { force: true });
      this.kept.delete(file);
      this.stamps.delete(file);
      const names = await readdir(this.asideDir).catch(() => [] as string[]);
      for (const name of names) if (panelOfFile(name) === instanceId) await rm(path.join(this.asideDir, name), { force: true });
    });
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
        .filter((name) => name.endsWith(".json") && !keep.has(panelOfFile(name)))
        .map((name) =>
          this.queue.run(async () => {
            await rm(path.join(this.dir, name), { force: true });
            this.kept.delete(path.join(this.dir, name));
            this.stamps.delete(path.join(this.dir, name));
          }),
        ),
    );
    const aside = await readdir(this.asideDir).catch(() => [] as string[]);
    await Promise.all(aside.filter((name) => !keep.has(panelOfFile(name))).map((name) => this.queue.run(() => rm(path.join(this.asideDir, name), { force: true }))));
  }
}

/** The folder in panel-state/ that holds the state other owners left (PanelStateStore). */
const ASIDE_FOLDER = "aside";

/** A short name for an owner, safe in a file name. */
function ownerTag(owner: string): string {
  return createHash("sha256").update(owner).digest("hex").slice(0, 16);
}

/** The panel a state file is of: `<instanceId>.json`, or `aside/<instanceId>.<owner tag>.json`. */
function panelOfFile(name: string): string {
  return /^(.+?)(\.[0-9a-f]{16})?\.json$/.exec(name)?.[1] ?? name;
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
  private readonly appFiles = new Map<string, BlobStore>();
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

  /**
   * The files one owner's module shares across every workspace (blobs.app): `<owner>/<module>/_app` in the files
   * folder, with the same limits as a workspace's files.
   */
  appBlobs(owner: string, moduleId: string): BlobStore {
    if (!isOwnerId(owner) || !isModuleId(moduleId)) throw new Error("invalid owner or module id");
    const key = `${owner}/${moduleId}`;
    let store = this.appFiles.get(key);
    if (!store) this.appFiles.set(key, (store = new BlobStore(() => path.join(this.blobRoot(), owner, moduleId, APP_DATA_DIR), undefined, this.blobsLocked, "app")));
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
    this.appFiles.delete(`${owner}/${moduleId}`);
  }

  /** Drops cached stores for a workspace whose data is being deleted. */
  forgetWorkspace(workspaceId: string): void {
    for (const key of [...this.data.keys()]) {
      if (path.basename(key) === workspaceId) this.data.delete(key);
    }
  }
}
