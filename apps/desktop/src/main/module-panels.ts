import { continuingPanelType, panelTypes, type ResolvedPanelType } from "@tavora/module-schema";
import type { TavoraWorkspace } from "@tavora/sdk/protocol";
import { isVoicePaused } from "../shared/discord-voice";
import { SerialQueue } from "./fsutil";
import type { GrantStore } from "./grants";
import type { Installed, InstalledModules } from "./installed-modules";
import { viewsOfAnotherOwner } from "./module-owner";
import { movedModule } from "./moved-modules";
import type { PanelViews } from "./panel-views";
import { panelsWait, type InstalledModule } from "./registry";
import type { PanelStateStore } from "./storage";
import type { InstanceRecord, Workspaces } from "./workspace";

/** An open module panel's page, as a reload sees it (module-view.ts ModuleView). */
export interface ReloadedView {
  readonly instanceId: string;
  readonly moduleId: string;
  /** The owner the page runs as. */
  readonly owner: string;
  readonly workspaceId: string;
  /** Starts the page again from `module` (a new version, a new grant); undefined when the module is gone. */
  reload(module?: InstalledModule): void;
}

export interface ModulePanelsOptions {
  /** The modules installed now; a reload puts what it found in place. */
  installed: Installed;
  /** One look at the module folders (installed-modules.ts), with whatever else a look finds out. */
  load: () => Promise<InstalledModules>;
  grants: Pick<GrantStore, "missing">;
  workspaces: Pick<Workspaces, "panels" | "dropMissingModules" | "noteOwners" | "settlePanelTypes" | "save" | "saveSoon">;
  panels: Pick<PanelViews, "has" | "close" | "restart" | "setAwaiting" | "stopAwaiting" | "applyBounds">;
  /** The open module panels' pages. */
  views: () => readonly ReloadedView[];
  panelState: Pick<PanelStateStore, "handOver">;
  /** The workspace shown now; null on Home and the Overlay page. */
  shownWorkspace: () => TavoraWorkspace | null;
  /** Starts a panel's page (host.ts createView); `openedAt` is when the user asked for it. */
  start: (record: InstanceRecord, workspace: TavoraWorkspace, openedAt?: number) => void;
  /** Closes a panel for good, its UI state with it (host.ts closeView). */
  close: (instanceId: string) => void;
  /** A module's pages start again: its tooltips' skins go with them. */
  forgetTooltips: (moduleId: string) => void;
  /** After a look, once the panels have their types: what else follows the modules (streams, notes, overlays, panels with their game). */
  modulesChanged: (restarted: boolean) => Promise<void>;
  /** The last step of a look (development folders watched again, publisher names). */
  looked: () => Promise<void>;
  pushState: () => void;
}

/**
 * How the installed modules reach the panels: which panel type a panel shows, whether a module's panels must ask before
 * they run, and what a new look at the module folders does to the open panels. A module gone closes its panels; one
 * loaded for another owner restarts them in place as the new owner's; one loaded from another folder reloads them.
 */
export class ModulePanels {
  private readonly reloads = new SerialQueue();

  constructor(private readonly options: ModulePanelsOptions) {}

  /**
   * Whether a module's panels stay in their workspaces: it is installed, it can't load right now (being rebuilt, not
   * built, needing a newer Tavora, a folder that can't be read), or it left Tavora for the catalog and offers to install.
   */
  keepsPanels(moduleId: string): boolean {
    return this.options.installed.modules.has(moduleId) || panelsWait(this.options.installed.problems)(moduleId) || movedModule(moduleId) !== undefined;
  }

  /**
   * The panel type a panel shows, with the module's entry, icon and sizes filled in and its texts in Tavora's language;
   * null for a module without types, undefined when the module no longer offers the panel's type (or is not loaded).
   */
  typeOf(record: Pick<InstanceRecord, "moduleId" | "panelType">): ResolvedPanelType | null | undefined {
    const module = this.options.installed.shown(record.moduleId);
    // Discord voice is paused (shared/discord-voice.ts): its panels never start, and their slot says so.
    if (!module || isVoicePaused(record.moduleId)) return undefined;
    const types = panelTypes(module.manifest);
    if (types.length === 0) return null;
    return types.find((type) => type.id === record.panelType);
  }

  /** A module that still misses access it needs: its panels ask before its page may run (host.ts questionOf). */
  needsAnswer(moduleId: string): boolean {
    const module = this.options.installed.get(moduleId);
    if (!module || module.builtIn) return false;
    const missing = this.options.grants.missing(module);
    return missing.network.length > 0 || missing.connectors.length > 0 || missing.folders.length > 0 || missing.withGame === true;
  }

  /**
   * Looks for modules again; panels of modules that are gone are closed, and panels of a module now loaded from another
   * folder start again from it (a blocked built-in update falls back to the shipped copy at once). Answers with the
   * modules whose panels started again. One at a time: a look that finished later with an older view of the folders
   * would close the panels of a module the newer one just found.
   */
  reload(): Promise<ReadonlySet<string>> {
    return this.reloads.run(() => this.reloadNow());
  }

  /** Starts a module's open panels again, so they load a new version or connect with a new grant. */
  reloadViews(moduleId: string): void {
    // Its pages start again and define their skins anew (a new version may have other files).
    this.options.forgetTooltips(moduleId);
    const current = this.options.installed.get(moduleId);
    for (const view of this.options.views()) if (view.moduleId === moduleId) view.reload(current);
    this.startWaiting(moduleId);
  }

  private async reloadNow(): Promise<ReadonlySet<string>> {
    const { installed, workspaces, panels } = this.options;
    const roots = new Map([...installed.modules].map(([id, module]) => [id, module.root]));
    installed.replace(await this.options.load());
    const { modules } = installed;
    // Closes and forgets every panel whose module is not installed any more, in every workspace. Module data stays. A
    // module that is there but cannot load right now keeps its panels; they start again once it loads (syncPanelTypes).
    for (const instanceId of workspaces.dropMissingModules((moduleId) => this.keepsPanels(moduleId))) this.options.close(instanceId);
    // A module id now loaded for another owner (a development folder over an installed copy, or back): its open panels
    // end, so no page runs as one owner with another's grants. What the old page left in the panel stays its owner's:
    // its panel state is kept apart (the new owner reads none of it, and the closing page's last writes are dropped),
    // and the content its tab named goes. The panels keep their place and start again as the new owner's below
    // (syncPanelTypes, and the overlays in modulesChanged), or ask first when that copy still misses access.
    const restarted = new Set<string>();
    let contentDropped = false;
    for (const view of viewsOfAnotherOwner(this.options.views(), modules)) {
      restarted.add(view.moduleId);
      this.options.forgetTooltips(view.moduleId);
      const owner = modules.get(view.moduleId)!.owner;
      void this.options.panelState.handOver(view.instanceId, view.owner, owner).catch((error: unknown) => console.error("[tavora]", error));
      const record = workspaces.panels(view.workspaceId).find((item) => item.instanceId === view.instanceId);
      if (record) {
        delete record.content;
        record.owner = owner;
        contentDropped = true;
      }
      // In place: closing for good would forget the panel's bounds, and the host UI sends none while they don't change.
      panels.restart(view.instanceId);
      if (this.needsAnswer(view.moduleId)) panels.setAwaiting(view.instanceId);
    }
    if (contentDropped) workspaces.saveSoon();
    // Panels that are not open (another workspace, or waiting) are handed over when they start (host.ts settleOwner);
    // those of a module that wasn't loaded before get its owner now.
    workspaces.noteOwners((moduleId) => modules.get(moduleId)?.owner);
    workspaces.settlePanelTypes(panelTypesOf(modules));
    this.syncPanelTypes();
    await this.options.modulesChanged(restarted.size > 0);
    const moved = new Set([...modules].filter(([id, module]) => roots.has(id) && roots.get(id) !== module.root).map(([id]) => id));
    // Panels started anew just now load the new copy already; panels that waited for the old copy's question start
    // now if the new copy asks nothing.
    for (const id of restarted) this.startWaiting(id);
    for (const id of moved) if (!restarted.has(id)) this.reloadViews(id);
    // Their places didn't change, so the host UI sends none: the new views go where the old ones were.
    if (restarted.size > 0) panels.applyBounds();
    await this.options.looked();
    return moved;
  }

  /**
   * After modules were looked for again: a panel whose type an update removed stops and its slot says so (the decision
   * log, named panels round 4); one whose type came back starts again.
   */
  private syncPanelTypes(): void {
    const workspace = this.options.shownWorkspace();
    if (!workspace) return;
    for (const record of this.options.workspaces.panels(workspace.id)) {
      const open = this.options.panels.has(record.instanceId);
      const missing = this.typeOf(record) === undefined;
      if (open && missing) this.options.panels.close(record.instanceId);
      else if (!open && !missing) this.options.start(record, workspace);
    }
    this.options.workspaces.save();
  }

  /** Panels of a module that asked before they could run start now, in the workspace shown (the others start when it opens). */
  private startWaiting(moduleId: string): void {
    const workspace = this.options.shownWorkspace();
    if (!workspace) return;
    if (this.needsAnswer(moduleId)) return;
    for (const record of this.options.workspaces.panels(workspace.id)) {
      if (record.moduleId !== moduleId || !this.options.panels.stopAwaiting(record.instanceId)) continue;
      this.options.start(record, workspace, performance.now());
    }
    // The window already said where these panels are; put the new pages there now, so they load and show.
    this.options.panels.applyBounds();
    this.options.pushState();
  }
}

/** What settlePanelTypes needs to know about the installed modules. */
export function panelTypesOf(modules: ReadonlyMap<string, InstalledModule>) {
  return (moduleId: string) => {
    const module = modules.get(moduleId);
    if (!module) return undefined;
    return { ids: panelTypes(module.manifest).map((type) => type.id), continuing: continuingPanelType(module.manifest) };
  };
}
