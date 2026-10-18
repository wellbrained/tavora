// Keeps modules installed from the catalog up to date (catalog threat model, C3, C4, C11). The whole
// index is downloaded and compared on the PC, so the service never learns what a player has. An
// update goes through every installer rule before anything else: the zip must be the listed one,
// from the module's owner and newer than what is installed. One that asks for nothing new installs
// at once and its panels reload; one that asks for new network hosts or connectors waits, fully
// checked, until the player says yes, and the installed version keeps running until then.
import type { Connector, ModuleManifest } from "@tavora/module-schema";
import type { ModuleNote } from "../shared/host-api";
import type { CatalogClient, CatalogEntry, CatalogVersion } from "./catalog-client";
import type { Permissions } from "./grants";
import { compareModuleVersions, type CheckedZip, type Installed } from "./installer";

/** How often the catalog is asked for updates while Tavora runs. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** A module the catalog keeps up to date: what is installed now. */
export interface CatalogInstalled {
  id: string;
  owner: string;
  version: string;
  /** What the installed version asks for. */
  asks: Permissions;
}

/** An update that asks for more than the installed version, checked and waiting for the player. */
export interface PendingUpdate {
  id: string;
  owner: string;
  /** The installed version it replaces. */
  from: string;
  version: string;
  /** What it asks for that the installed version did not. */
  asks: Permissions;
  /** The patch notes of the versions it brings, newest first. */
  notes: ModuleNote[];
  sha256: string;
  zip: Buffer;
}

/** What one check did. */
export interface CheckOutcome {
  updated: Installed[];
  waiting: PendingUpdate[];
}

/** The listings that are updates: same module and owner, a newer version, one this Tavora can run. */
export function findUpdates(index: readonly CatalogEntry[], installed: readonly CatalogInstalled[], tavoraVersion: string): CatalogEntry[] {
  const listed = new Map(index.map((entry) => [entry.id, entry]));
  const updates: CatalogEntry[] = [];
  for (const module of installed) {
    const entry = listed.get(module.id);
    if (!entry || entry.owner !== module.owner) continue;
    if (compareModuleVersions(entry.version, module.version) <= 0) continue;
    if (entry.minTavora && compareModuleVersions(entry.minTavora, tavoraVersion) > 0) continue;
    updates.push(entry);
  }
  return updates;
}

/** What `after` asks for that `before` did not. */
export function newAsks(before: Permissions, after: Pick<ModuleManifest, "permissions">["permissions"]): Permissions {
  const hosts = new Set(before.network);
  const connectors = new Set(before.connectors);
  return {
    network: after.network.filter((host) => !hosts.has(host)),
    connectors: (after.connectors ?? []).filter((name: Connector) => !connectors.has(name)),
  };
}

export function asksNothing(asks: Permissions): boolean {
  return asks.network.length === 0 && asks.connectors.length === 0;
}

/**
 * The notes of the versions newer than the installed one, up to the update, newest first. Without a
 * version list (an older service, or none could be read) the listing's own notes stand for the update.
 */
export function notesSince(versions: readonly CatalogVersion[], from: string, to: string, fallback: readonly string[]): ModuleNote[] {
  const between = versions
    .filter((item) => compareModuleVersions(item.version, from) > 0 && compareModuleVersions(item.version, to) <= 0 && item.notes.length > 0)
    .sort((a, b) => compareModuleVersions(b.version, a.version))
    .map((item) => ({ version: item.version, ...(item.publishedAt ? { date: item.publishedAt.slice(0, 10) } : {}), notes: [...item.notes] }));
  if (between.length > 0 || versions.length > 0) return between;
  return fallback.length > 0 ? [{ version: to, notes: [...fallback] }] : [];
}

export interface CatalogUpdaterOptions {
  client: Pick<CatalogClient, "index" | "details" | "download">;
  /** The modules installed from the catalog, as they are now. */
  installed(): CatalogInstalled[];
  tavoraVersion: string;
  /** Every installer check, nothing written (installer.ts `checkZipData`), against what is installed now. */
  check(zip: Buffer, expect: { id: string; owner: string }): Promise<CheckedZip>;
  /** Installs a zip by every installer rule, as a catalog module, and reloads its panels. */
  install(zip: Buffer, expect: { id: string; owner: string }): Promise<Installed>;
  log?(line: string): void;
}

export class CatalogUpdater {
  private readonly pendingUpdates = new Map<string, PendingUpdate>();
  private running: Promise<CheckOutcome> | null = null;

  constructor(private readonly options: CatalogUpdaterOptions) {}

  /** The update waiting for the player's yes for a module, if any. */
  pending(id: string): PendingUpdate | undefined {
    return this.pendingUpdates.get(id);
  }

  /** Forgets a waiting update, such as when its module was removed or replaced by hand. */
  forget(id: string): void {
    this.pendingUpdates.delete(id);
  }

  /** Looks for updates once; a check asked for while one runs gets that one's outcome. Never throws. */
  check(): Promise<CheckOutcome> {
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
  }

  /**
   * The player said yes to a waiting update (exactly `version`, the one they were shown): it is
   * installed by every installer rule again, against what is installed now.
   */
  async apply(id: string, version: string): Promise<{ installed: Installed; asks: Permissions }> {
    const pending = this.pendingUpdates.get(id);
    if (!pending || pending.version !== version) throw new Error(`no update of ${id} to ${version} is waiting`);
    const installed = await this.options.install(pending.zip, { id, owner: pending.owner });
    this.pendingUpdates.delete(id);
    return { installed, asks: pending.asks };
  }

  private async run(): Promise<CheckOutcome> {
    const outcome: CheckOutcome = { updated: [], waiting: [] };
    const installed = this.options.installed();
    // A waiting update whose module went, or that is no longer newer than what is installed, is dropped.
    for (const [id, pending] of this.pendingUpdates) {
      const module = installed.find((item) => item.id === id);
      if (!module || module.owner !== pending.owner || compareModuleVersions(pending.version, module.version) <= 0) this.pendingUpdates.delete(id);
    }
    if (installed.length === 0) return outcome;
    const index = await this.options.client.index();
    if (!index) return outcome;
    for (const entry of findUpdates(index, installed, this.options.tavoraVersion)) {
      const module = installed.find((item) => item.id === entry.id)!;
      const waiting = this.pendingUpdates.get(entry.id);
      if (waiting?.sha256 === entry.zip.sha256) {
        outcome.waiting.push(waiting);
        continue;
      }
      try {
        const zip = await this.options.client.download(entry.zip);
        const expect = { id: entry.id, owner: module.owner };
        const checked = await this.options.check(zip, expect);
        const asks = newAsks(module.asks, checked.manifest.permissions);
        if (asksNothing(asks)) {
          outcome.updated.push(await this.options.install(zip, expect));
          this.pendingUpdates.delete(entry.id);
          continue;
        }
        const versions = await this.options.client.details(entry.id).then(
          (details) => details.versions,
          () => [],
        );
        const pending: PendingUpdate = {
          id: entry.id,
          owner: module.owner,
          from: module.version,
          version: checked.manifest.version,
          asks,
          notes: notesSince(versions, module.version, checked.manifest.version, entry.notes),
          sha256: entry.zip.sha256,
          zip,
        };
        this.pendingUpdates.set(entry.id, pending);
        outcome.waiting.push(pending);
      } catch (error) {
        // A refused or failed update changes nothing; the installed version keeps running.
        this.options.log?.(`catalog update of ${entry.id} to ${entry.version} not installed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return outcome;
  }
}
