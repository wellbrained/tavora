import { randomUUID } from "node:crypto";
import path from "node:path";
import { continuingPanelType } from "@tavora/module-schema";
import type { ActionResult, OnlineSearchResult, SteamImportGame } from "../shared/host-api";
import { translate, type Language } from "../shared/i18n";
import type { FileDialogs } from "./file-dialogs";
import { addOrRestoreWorkspace } from "./game-copy";
import type { GameIcons } from "./game-icons";
import type { Installed } from "./installed-modules";
import { deleteTrashedWorkspace, isLive, LibraryError, placeOf, restoreWorkspace, trashWorkspace, untrashWorkspaces, type Library, type NewWorkspace, type WorkspaceEntry } from "./library";
import { deleteModuleData, partitionsOf, type Trash } from "./module-data";
import type { ModuleFilesFolder } from "./module-files-folder";
import type { InstalledModule } from "./registry";
import { importSteamGames } from "./steam-import";
import type { PanelStateStore } from "./storage";
import { UndoGoneError, type UndoShelf } from "./undo-shelf";
import type { InstanceRecord, Workspaces } from "./workspace";
import { withOnlineId } from "./workspace-game";

/** The modules a game workspace the user just added starts with, side by side, when they are installed and fit it. */
export const STARTER_MODULES = ["tavora.notes", "tavora.todos"] as const;

export interface WorkspaceLibraryOptions {
  library: Library;
  saveLibrary: () => void;
  /** Every workspace's panels, layout and snapshots (workspace.ts). */
  workspaces: Workspaces;
  installed: Installed;
  /** Whether a module works in a workspace (its games, or a personal workspace it allows). */
  fits: (module: InstalledModule, workspaceId: string) => boolean;
  /** Where a delete keeps how to put it back while its toast offers Undo. */
  undos: UndoShelf;
  userData: string;
  language: () => Language;
  /** Looks a game up online by its name; only asked while online features are on. */
  lookUp: (query: string) => Promise<OnlineSearchResult>;
  icons: Pick<GameIcons, "lookSoon" | "forget" | "importImage" | "choose">;
  dialogs: Pick<FileDialogs, "pick" | "remember">;
  /** A game the library has now (added, back from Trash, or one that learned its Steam id) may be running: the rail looks. */
  gameListed: (workspaceId: string) => void;
  /** Workspaces went to Trash or came back: the panels kept running for overlays are looked at again. */
  overlaysChanged: () => void;
  /** The screens: which workspace is shown, whether Home is, and going to either. */
  screen: {
    /** The workspace shown now; null on Home or another page. */
    shown(): string | null;
    /** Home is shown. */
    onHome(): boolean;
    goHome(): void;
    open(workspaceId: string): void;
  };
  /** The panels' views. */
  views: {
    /** Starts a panel just added to the shown workspace; with `welcome` false its page doesn't greet the user. */
    start(record: InstanceRecord, welcome: boolean): void;
    /** Closes a panel the user took away; its state goes once its page has closed. */
    close(instanceId: string): void;
    /** Closes a panel whose data goes now: its page doesn't get the moment to save a closed panel gets. */
    drop(instanceId: string): void;
  };
  panelState: Pick<PanelStateStore, "remove">;
  /** Where modules keep their files; a workspace deleted for good takes its files with it. */
  files: Pick<ModuleFilesFolder, "noteWorkspaceDeleted">;
  /** Sends a workspace's folder in the files folder (often Pictures\Tavora) to the Recycle Bin; without it, only Tavora's files there are deleted. */
  trash?: Trash | undefined;
  /** Whatever else keeps something per workspace (module data, stream and game overlays, the Overlay page) forgets it. */
  forgotten: (workspaceId: string) => void;
  /** Clears a browser session's storage and cache, by partition (Electron's session). */
  clearSession: (partition: string) => Promise<void>;
}

/**
 * The workspaces in the library and what they keep: adding one (a game the user has is answered as it is, one in Trash
 * comes back), Steam imports, Trash with Undo, deleting for good with everything stored for it, a workspace's picture,
 * and the snapshots of its layout that change open panels. The library's own rules are library.ts's; this decides what
 * follows them (panels that start or close, icons, the rail, data that goes).
 */
export class WorkspaceLibrary {
  constructor(private readonly options: WorkspaceLibraryOptions) {}

  /**
   * Adds a game or personal workspace, from wherever the user adds one (Add a game, the welcome, Ctrl+K, the running
   * game's Add button). A game the user has is answered as it is, and one whose only copy is in Trash comes back with its
   * panels. A game known only by its name and Steam id is looked up online first, so it gets the id modules are made for
   * (workspace-game.ts). A new game starts with the starter modules.
   */
  async add(input: NewWorkspace): Promise<ActionResult | string> {
    const { library, saveLibrary, gameListed } = this.options;
    const named = await withOnlineId(input, library.onlineSearch ? (query) => this.options.lookUp(query) : null);
    const { id, restored, existing, learned } = addOrRestoreWorkspace(library, named, new Date());
    if (existing) {
      // The copy took the game's Steam id: saved, and the rail may now see it running.
      if (learned) {
        saveLibrary();
        gameListed(id);
      }
      return { ok: true, id, existing };
    }
    if (!restored) {
      this.options.workspaces.addWorkspaces([id]);
      this.start(id);
    }
    saveLibrary();
    this.options.icons.lookSoon();
    // A game running now (the rail offered to add it) shows as running at once, and the game may have been installed
    // since the last look.
    gameListed(id);
    return restored ? { ok: true, id, restored } : id;
  }

  /** Adds the games of a Steam import that are not in the library yet. Answers with how many. */
  importSteam(games: SteamImportGame[]): ActionResult {
    const added = importSteamGames(this.options.library, games, new Date());
    this.options.workspaces.addWorkspaces(added);
    // Saved even with nothing added: a game already here may have learned its game's id from the import.
    this.options.saveLibrary();
    if (added.length > 0) this.options.icons.lookSoon();
    return { ok: true, added: added.length };
  }

  /**
   * Moves workspaces to Trash and answers with the token that takes them back: out of Trash into their places. `strict`:
   * every one must be there; else those already gone are skipped, so a list the screen showed a moment ago still works.
   * Undo opens a workspace again only when it was open and the user is still on the Home it left them on; one switched to
   * meanwhile stays open. An open one is left for Home before it is trashed: trashing clears the library's last workspace,
   * which is what the screen shows, and leaving it is what ends its panels and questions.
   */
  trash(ids: readonly string[], strict: boolean): string {
    const { library, saveLibrary, screen } = this.options;
    const live = strict ? [...new Set(ids)] : [...new Set(ids)].filter((id) => isLive(library, id));
    const places = live.map((id) => placeOf(library, id));
    const shown = screen.shown();
    const wasOpen = shown !== null && live.includes(shown) ? shown : null;
    if (wasOpen) screen.goHome();
    const now = new Date();
    for (const id of live) trashWorkspace(library, id, now);
    saveLibrary();
    // Panels kept running for overlays of a workspace in Trash stop now.
    this.options.overlaysChanged();
    return this.options.undos.keep(() => {
      const back = untrashWorkspaces(library, places);
      if (!back.length) throw new UndoGoneError();
      saveLibrary();
      this.options.overlaysChanged();
      if (wasOpen && back.includes(wasOpen) && screen.onHome()) screen.open(wasOpen);
    });
  }

  /** Takes workspaces out of Trash, at the end of the rail. `strict`: each must be in Trash; else others are skipped. */
  restore(ids: readonly string[], strict: boolean): void {
    const { library } = this.options;
    for (const id of ids) {
      if (!strict && !library.workspaces[id]?.trashedAt) continue;
      restoreWorkspace(library, id);
      // A game running now comes back as running, not as one that just started (no switch or question).
      this.options.gameListed(id);
    }
    this.options.overlaysChanged();
  }

  /** Deletes workspaces in Trash for good, with everything stored for them. `strict`: each must be in Trash; else others are skipped. */
  async delete(ids: readonly string[], strict: boolean): Promise<void> {
    const { library } = this.options;
    const workspaces = (strict ? ids : ids.filter((id) => library.workspaces[id]?.trashedAt)).map((id) => deleteTrashedWorkspace(library, id));
    this.options.saveLibrary();
    const errors = await this.forgetAll(workspaces);
    if (errors.length === 0) return;
    // Back in Trash: saved again, and the user hears that it failed.
    this.options.saveLibrary();
    throw errors[0];
  }

  /**
   * Deletes everything stored for the workspaces whose time in Trash ran out (purgeExpired), at the start. Never throws,
   * so Tavora starts: one that can't be deleted now goes back to Trash and is tried again at the next start. The caller
   * saves the library. `sessions: false` at the start: no session has been opened yet, and the caller removes their
   * browser storage folders itself, which an opened session would hold (EBUSY on Windows).
   */
  async deleteExpired(workspaces: readonly WorkspaceEntry[], { sessions = true }: { sessions?: boolean } = {}): Promise<void> {
    await this.forgetAll(workspaces, sessions).catch((error: unknown) => console.error("[tavora] clearing the browser storage of deleted workspaces failed", error));
  }

  /**
   * Forgets the data of workspaces that left the library for good, one by one. A workspace whose data can't all be
   * deleted now (a file another program holds) goes back to Trash as it was, so a later try finishes it, and the others
   * still go. Answers with what went wrong.
   */
  private async forgetAll(workspaces: readonly WorkspaceEntry[], sessions = true): Promise<unknown[]> {
    const { library } = this.options;
    const errors: unknown[] = [];
    const gone: string[] = [];
    for (const workspace of workspaces) {
      try {
        await this.forgetData(workspace);
        gone.push(workspace.id);
      } catch (error) {
        console.error(`[tavora] deleting the data of workspace ${workspace.id} failed; it stays in Trash for a later try`, error);
        library.workspaces[workspace.id] ??= workspace;
        errors.push(error);
      }
    }
    if (sessions) await this.clearSessions(gone);
    return errors;
  }

  /** The user picks a picture for a workspace's icon; nothing when the dialog is closed. */
  async chooseImage(workspaceId: string): Promise<void> {
    const { library, dialogs, icons } = this.options;
    if (!isLive(library, workspaceId)) throw new LibraryError("error.workspaceGone");
    const language = this.options.language();
    const source = await dialogs.pick("workspace-image", {
      title: translate(language, "dialog.chooseIcon"),
      properties: ["openFile"],
      filters: [{ name: translate(language, "dialog.images"), extensions: ["png", "jpg", "jpeg"] }],
    });
    if (!source) return;
    const file = await icons.importImage(workspaceId, source);
    dialogs.remember("workspace-image", source);
    await icons.choose(workspaceId, { kind: "image", file });
  }

  /** Replaces a workspace's open panels with a snapshot's; views start for the new panels and stop for the rest. */
  applySnapshot(workspaceId: string, snapshotId: string): void {
    const { opened, closed } = this.options.workspaces.applySnapshot(workspaceId, snapshotId);
    for (const record of closed) this.options.views.close(record.instanceId);
    // A layout is one click: one welcome at most.
    for (const [index, record] of opened.entries()) this.options.views.start(record, index === opened.length - 1);
  }

  /** Deletes a snapshot; answers with the token whose Undo puts it back into the workspace it came from, whichever is open by then. */
  deleteSnapshot(workspaceId: string, snapshotId: string): string {
    const { workspaces } = this.options;
    const removed = workspaces.deleteSnapshot(workspaceId, snapshotId);
    return this.options.undos.keep(() => {
      if (!workspaces.restoreSnapshot(removed)) throw new UndoGoneError();
    });
  }

  /**
   * A game workspace the user just added starts with Notes and To-Dos side by side, so the first look shows something
   * to use rather than a layout to choose. Only the starter modules that are installed and work in this workspace are
   * docked; a personal workspace, and workspaces that arrive by other ways (a Steam import, a restored library), start
   * empty.
   */
  private start(workspaceId: string): void {
    if (this.options.library.workspaces[workspaceId]?.kind !== "game") return;
    const records = STARTER_MODULES.flatMap((moduleId): InstanceRecord[] => {
      const module = this.options.installed.get(moduleId);
      if (!module || !this.options.fits(module, workspaceId)) return [];
      const panelType = continuingPanelType(module.manifest) ?? undefined;
      return [{ instanceId: randomUUID(), moduleId, ...(panelType ? { panelType } : {}) }];
    });
    this.options.workspaces.start(workspaceId, records);
  }

  /** Everything stored for a deleted workspace but its browser sessions, so many can be deleted and the sessions cleared once. */
  private async forgetData(workspace: WorkspaceEntry): Promise<void> {
    const { workspaces, views, panelState, files, userData } = this.options;
    // The files first: that is the part another program can hold (a picture open in a viewer), and when it fails the workspace
    // goes back to Trash whole, with its layout and panels, so Restore still gives the user a working workspace.
    // A folder the user chose can be gone (an unplugged drive): the workspace still goes, and they are told where its pictures may remain.
    await files.noteWorkspaceDeleted(workspace.name, (root) => deleteModuleData(userData, workspace.id, root, this.options.trash));
    const records = workspaces.forgetWorkspace(workspace.id);
    // Its layout is gone now, so nothing after this may put it back in Trash (it would come back empty, hunt 2026-11-25
    // A4): each step is done as far as it goes, and what is left (a panel-state file held for a moment) is only logged.
    const step = async (what: string, run: () => unknown) => {
      try {
        await run();
      } catch (error) {
        console.error(`[tavora] deleting workspace ${workspace.id}: ${what} failed; the rest went`, error);
      }
    };
    // A panel of this workspace that was over its game closes with it.
    for (const record of records) await step("closing a panel over its game", () => views.drop(record.instanceId));
    await Promise.all(records.map((record) => step("removing a panel's saved state", () => panelState.remove(record.instanceId))));
    await step("forgetting its settings", () => this.options.forgotten(workspace.id));
    await step("forgetting its icon", () => this.options.icons.forget(workspace));
  }

  /**
   * Sessions may already be open in this run, so they are cleared; their folders are removed at the next start. Only
   * these workspaces': after a lost library, others not in it may be the user's (holdLeftovers).
   */
  private async clearSessions(workspaceIds: string[]): Promise<void> {
    for (const dir of await partitionsOf(this.options.userData, workspaceIds)) await this.options.clearSession(`persist:${decodeURIComponent(path.basename(dir))}`);
  }
}
