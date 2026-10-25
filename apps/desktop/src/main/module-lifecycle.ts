// The module lifecycle: installing, updating and removing a module, and granting or taking back what
// it asks for. Each is a fixed order of steps the security model counts on (apps/docs/guide/security.md):
// a removed module's grants go with it, a revoke closes its panels before the grant goes, and an update
// that asks for more is granted only what the player was shown. The host lends it its panels, the
// recycle bin and the module list; the steps and their order live here.
import path from "node:path";
import { LOCAL_OWNER, type Connector } from "@tavora/module-schema";
import type { CatalogClient } from "./catalog-client";
import { CatalogUpdater, type CatalogInstalled } from "./catalog-updates";
import type { GrantStore } from "./grants";
import { checkZipData, forgetOwner, installZip, installZipData, type InstallOptions, type Installed } from "./installer";
import { LibraryError } from "./library";
import { PlayerError } from "./messages";
import type { InstalledModule } from "./registry";
import type { SafetyCheck } from "./safety-lists";

/** What the lifecycle may do to a module's open panels. */
export interface ModulePanels {
  /** Starts a module's open panels again, so they load a new version or connect with a new grant. */
  reload(moduleId: string): void;
  /** Closes a module's panels in every game, leaving their slots empty. */
  close(moduleId: string): void;
}

export interface ModuleLifecycleOptions {
  userData: string;
  tavoraVersion: string;
  /** The modules loaded now. */
  modules(): ReadonlyMap<string, InstalledModule>;
  /** The modules stopped because their zip is blocked; they still count as installed, so a fixed zip is their update. */
  blocked(): ReadonlyMap<string, InstalledModule>;
  /** The ids the installer recorded as installed from the catalog. */
  catalogIds(): ReadonlySet<string>;
  /** Whether a module is in the player's own modules folder, so they may remove it. */
  removable(moduleId: string): boolean;
  /** The player's modules folder (real path) and the newest safety lists, held ones when offline (C6, C14). */
  installRules(): Promise<{ userModules: string; safety?: SafetyCheck }>;
  /** What the player granted each module (grants.ts). */
  grants(): GrantStore;
  catalog: Pick<CatalogClient, "index" | "details" | "download" | "module" | "installed">;
  /** Whether online features are on; the catalog is not asked otherwise. */
  online(): boolean;
  /** Whether catalog updates that ask for nothing new install by themselves. */
  autoUpdateModules(): boolean;
  /** The first key of a key's account by its successions (safety-lists.ts). */
  firstKey(key: string): string;
  panels: ModulePanels;
  /** Moves a module's folder to the recycle bin. */
  trash(dir: string): Promise<void>;
  /** Looks for modules again, so `modules()` and `blocked()` say what is on disk now. */
  reload(): Promise<void>;
  /** Learns the developer name of a publisher key, so an install can say it at once. */
  introduce(owner: string): Promise<void>;
  log?(line: string): void;
}

export class ModuleLifecycle {
  /** Keeps modules installed from the catalog up to date (catalog-updates.ts). */
  readonly updates: CatalogUpdater;

  constructor(private readonly options: ModuleLifecycleOptions) {
    this.updates = new CatalogUpdater({
      client: options.catalog,
      installed: () => this.catalogInstalled(),
      autoInstall: () => options.autoUpdateModules(),
      tavoraVersion: options.tavoraVersion,
      firstKey: (key) => options.firstKey(key),
      check: async (zip, expect) => checkZipData(zip, { ...(await this.installOptions()), expect }),
      install: async (zip, expect) => {
        const installed = await installZipData(zip, { ...(await this.installOptions()), expect, catalog: true });
        await this.finishInstall(installed);
        return installed;
      },
      ...(options.log ? { log: options.log } : {}),
    });
  }

  /**
   * Installs a module from a zip the player picked (installer.ts). An update from the same publisher
   * replaces the folder and reloads its open panels. Answers with the module's id.
   */
  async installFile(file: string): Promise<string> {
    const installed = await installZip(file, await this.installOptions());
    // Replaced by hand: the catalog no longer keeps it up to date, and an update it was waiting for is dropped.
    this.updates.forget(installed.manifest.id);
    return this.finishInstall(installed);
  }

  /**
   * Installs a module from the catalog: its listing is asked for again here, never taken from the
   * host UI, and its zip must match the listed hash and be signed by the listed key (C1) before the
   * installer writes anything.
   */
  async installFromCatalog(moduleId: string): Promise<string> {
    if (!this.options.online()) throw new PlayerError("error.catalogOff");
    const entry = await this.options.catalog.module(moduleId);
    const zip = await this.options.catalog.download(entry.zip);
    const id = await this.finishInstall(await installZipData(zip, { ...(await this.installOptions()), expect: { id: entry.id, owner: entry.owner }, catalog: true }));
    // Counted only here, when the player pressed Install: updates download the zip too but aren't installs.
    void this.options.catalog.installed(id);
    return id;
  }

  /**
   * The player said yes to an update that asks for more (exactly the version they were shown): it is
   * checked and installed by every installer rule again, what it asked for is granted, and its panels
   * reload with the new version.
   */
  async applyUpdate(moduleId: string, version: string): Promise<string> {
    const module = this.options.modules().get(moduleId) ?? this.options.blocked().get(moduleId);
    const pending = this.updates.pending(moduleId);
    if (!module || !pending || pending.version !== version) throw new LibraryError("error.updateGone");
    const { installed, asks } = await this.updates.apply(moduleId, version);
    const updated = this.options.modules().get(moduleId);
    if (updated) {
      await this.options.grants().grant(updated, asks);
      this.options.panels.reload(moduleId);
    }
    return installed.manifest.id;
  }

  /** Moves a module out of the player's modules folder (to the recycle bin) and forgets it. */
  async remove(moduleId: string): Promise<void> {
    const module = this.options.modules().get(moduleId);
    if (!module || !this.options.removable(moduleId)) throw new LibraryError("error.removeOnlyOwn");
    try {
      await this.options.trash(module.root);
    } catch {
      throw new LibraryError("error.removeFailed");
    }
    this.options.panels.close(moduleId);
    // Its data stays under its owner, so the same publisher's module finds it again. Its grants go:
    // whatever is installed next under this id is asked again.
    await forgetOwner(this.options.userData, path.basename(module.root));
    await this.options.grants().revoke(module.owner, moduleId);
    this.updates.forget(moduleId);
    await this.options.reload();
  }

  /**
   * The player allowed what the consent dialog showed. Only hosts the module asks for are granted
   * (grants.ts), so a module updated while the dialog was open gets nothing it did not show. Open
   * panels of the module start again, so they connect with the new grant.
   */
  async grant(moduleId: string, network: string[], connectors: Connector[]): Promise<void> {
    const module = this.options.modules().get(moduleId);
    if (!module || module.builtIn) throw new LibraryError("error.moduleMissing");
    await this.options.grants().grant(module, { network, connectors });
    this.options.panels.reload(moduleId);
  }

  /** Takes back everything granted to a module, after its panels are removed in every game. Its data stays. */
  async revoke(moduleId: string): Promise<void> {
    const module = this.options.modules().get(moduleId);
    if (!module) throw new LibraryError("error.moduleMissing");
    this.options.panels.close(moduleId);
    await this.options.grants().revoke(module.owner, moduleId);
  }

  /** What every install goes by. A module stopped by a block still counts as installed, so a fixed zip is its update. */
  private async installOptions(): Promise<InstallOptions> {
    const { userModules, safety } = await this.options.installRules();
    return {
      userData: this.options.userData,
      userModules,
      modules: new Map([...this.options.blocked(), ...this.options.modules()]),
      tavoraVersion: this.options.tavoraVersion,
      ...(safety ? { safety } : {}),
    };
  }

  private async finishInstall(installed: Installed): Promise<string> {
    // The developer name comes with the install, so it is said at once (it waits for the service at most a few seconds).
    if (installed.owner !== LOCAL_OWNER) await this.options.introduce(installed.owner).catch(() => undefined);
    await this.options.reload();
    if (installed.updated) this.options.panels.reload(installed.manifest.id);
    return installed.manifest.id;
  }

  /** The modules installed from the catalog, as they are now, for the update check. */
  private catalogInstalled(): CatalogInstalled[] {
    const installed: CatalogInstalled[] = [];
    for (const id of this.options.catalogIds()) {
      // A module stopped by a block counts too: an update that is not blocked brings it back (C14).
      const module = this.options.modules().get(id) ?? this.options.blocked().get(id);
      if (!module || module.owner === LOCAL_OWNER) continue;
      const { network, connectors = [] } = module.manifest.permissions;
      installed.push({ id, owner: module.owner, version: module.manifest.version, asks: { network: [...network], connectors: [...connectors] } });
    }
    return installed;
  }
}
