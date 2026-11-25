/**
 * A panel's session: what the pages of one panel reach of the connectors and of Tavora's pickers, all through the
 * panel's gate (panel-gate.ts). One per panel view, across every page and port it has: it holds the gate (presses,
 * where the panel is, its live page) and the watches a page started (system info, media, folders, the Discord hold),
 * and ends them when the page goes (`pageGone`). ModuleView keeps the page itself: loading, showing, closing.
 */
import type {
  GameOverlayResult,
  HotkeyBinding,
  HotkeySetResult,
  JsonValue,
  OverlayLinkResult,
  OverlaySource,
  PickNear,
  ReadOnlyFile,
  SystemApps,
  SystemInfo,
  SystemTraffic,
  TavoraWorkspace,
} from "@tavora/sdk/protocol";
import type { BridgeContext } from "./bridge";
import { connectionAccess, type ConnectionWatcher } from "./connection";
import type { DiscordConnector, DiscordListener } from "./discord";
import { HostError } from "./errors";
import type { LinkFileRequest } from "./file-dialogs";
import type { FolderHost, FolderWatch } from "./folder-access";
import type { MediaConnector, MediaSubscription } from "./media";
import { moduleFetch, type TestHosts } from "./network";
import { moduleReadPage } from "./page-import";
import { grantedCapabilities, PanelGate, type GatePage, type PanelGateOptions } from "./panel-gate";
import type { ReadOnlyFiles } from "./read-only-files";
import type { InstalledModule } from "./registry";
import { saveDialogDirectory } from "./save-dialog-folder";
import type { SystemMonitor, SystemSubscription } from "./system-info";

/** What the bridge reaches of the connectors and pickers; the session makes it for each port (`connect`). */
export type SessionContext = Pick<BridgeContext, "capabilities" | "fetch" | "readPage" | "aiUsage" | "leaderboards" | "systemInfo" | "media" | "discord" | "folders" | "readOnlyFiles" | "overlay" | "clipboard" | "hotkeys">;

/** The connectors of the module as this panel uses them, from the host (host.ts createView). The session gates them. */
export interface PanelConnectors {
  /** Hosts the user granted this module for network.fetch, as installed now; asked on every call and redirect. */
  networkHosts(): ReadonlySet<string>;
  /** Connectors the user granted this module, as installed now; asked on every call. */
  connectors(): ReadonlySet<string>;
  /** The module's folders on this PC (permissions.folders), the grant asked on every call; none for a host without them. */
  folders?: FolderHost & { granted(): boolean };
  /** The ai-usage connector, for a module granted it. */
  aiUsage: BridgeContext["aiUsage"];
  /** The leaderboards connector for this module (leaderboards.ts); `show` asks the user in this panel. */
  leaderboards: BridgeContext["leaderboards"];
  /** The system-info connector, shared by every panel; each session holds one subscription of its own. */
  systemInfo: { info(): SystemInfo | Promise<SystemInfo>; subscribe: SystemMonitor["subscribe"]; apps(): Promise<SystemApps>; traffic(): Promise<SystemTraffic> };
  /** The connection watcher (connection.ts): its log and settings are shared by every panel. */
  connection: Pick<ConnectionWatcher, "outageLog" | "clearLog" | "getSettings" | "setSettings">;
  /** The media connector, shared by every panel; each session holds one subscription of its own while it watches. */
  media: Pick<MediaConnector, "subscribe">;
  /** The discord connector, shared by every panel; this session uses it under its panel's instance id. */
  discord: Pick<DiscordConnector, "use" | "release" | "state" | "connectNow" | "allowControl" | "command" | "subscribe" | "unsubscribe" | "image">;
  /** Overlays of this module in this workspace: Stream overlay links (granted the stream-overlay connector) and game overlays. */
  overlay: {
    publish(key: string, state: JsonValue): void;
    remove(key: string): void;
    copyLink(key: string): Promise<OverlayLinkResult>;
    /** Whether copyLink would open Tavora's window now (the consent dialog, or the setting that is off). */
    copyNeedsWindow?(): boolean;
    resetLink(key: string): void;
    showOverGame(key: string): GameOverlayResult;
    hideOverGame(key: string): void;
    overGame(): string[];
    /** overlay.setSources from this panel (already checked): what it can show over the game, for the Overlay page. */
    setSources(sources: OverlaySource[]): void;
    /** Opens the preview window of the overlay for `key`; throws INVALID_PARAMS for a module without an overlay page. */
    preview(key: string): Promise<void>;
    /** Shows the Overlay page and closes this panel's dialog (overlay.openPage, already given its click). */
    openPage(): void;
  };
  /** The system clipboard, written only through the gate. */
  clipboard: { writeText(text: string): void };
  /** Hotkeys of this module in this workspace; `set` opens Tavora's hotkey dialog. */
  hotkeys: { list(): HotkeyBinding[]; set(action: string, target: string, label: string): Promise<HotkeySetResult>; remove(target: string, action: string | null): void };
  /** Test runs only: hosts mapped to a local server (network.ts). */
  testHosts?: TestHosts;
}

export interface PanelSessionOptions extends Omit<PanelGateOptions, "module" | "granted"> {
  instanceId: string;
  /** The module the panel's page runs as now (a reload may bring a newer copy of the same owner). */
  module(): InstalledModule;
  workspace: TavoraWorkspace;
  hostVersion: string;
  connectors: PanelConnectors;
  /**
   * files.pickReadOnly, once the gate let it through: Tavora's open dialog to link files, starting in `start`; the
   * chosen paths (one unless `multiple`), empty when closed. None: nothing is picked.
   */
  pickReadOnly?(request: LinkFileRequest): Promise<string[]>;
  /** Where a pick with no file to start next to opens first: the game the panel's workspace is for (save-dialog-folder.ts). */
  pickGame(): string;
  /** The files this panel's module linked in this workspace (read-only-files.ts), for the module this view was made for (a reload keeps its owner and id). */
  readOnlyFiles(): ReadOnlyFiles;
  /** Shows a file in the system's file manager, selected; nothing is opened or launched. */
  showItemInFolder(path: string): void;
  /** The panel is hidden now (ModuleView suspend): a system watch made now starts paused. */
  suspended(): boolean;
}

/** A panel's session (see the top of this file). Lives as long as the panel's view. */
export class PanelSession {
  /** What this panel's page may call now: the grant, the press, where the panel is, and its live page. */
  readonly gate: PanelGate;
  /** This panel's watch of the PC (system-info.ts), once it asked to watch something. */
  private systemWatch: SystemSubscription | undefined;
  /** This panel's watch of what plays on the PC (media.ts), while it watches. */
  private mediaWatch: MediaSubscription | undefined;
  /** The folders this panel watches (folders.watch), by manifest path. */
  private readonly folderWatches = new Map<string, FolderWatch>();
  /** How many folders.watch calls each folder had, so a slow start can't outlive a later call. */
  private readonly folderTurns = new Map<string, number>();

  constructor(private readonly options: PanelSessionOptions) {
    const { connectors } = options;
    this.gate = new PanelGate({
      module: options.module(),
      // The grants of the owner the page runs as (host.ts): a copy of another owner under the same id has its own.
      granted: () => grantedCapabilities(connectors),
      page: options.page,
      runsOnlyWithGame: options.runsOnlyWithGame,
      overGame: options.overGame,
      onNeedsTavora: options.onNeedsTavora,
    });
  }

  /**
   * The connectors and pickers as one port's page reaches them (`page` is that port's session). `signal` ends with the
   * port: its network calls end with it.
   */
  connect(page: () => GatePage, signal: AbortSignal): SessionContext {
    const { connectors, hostVersion } = this.options;
    const moduleId = this.options.module().manifest.id;
    const userAgent = `Tavora/${hostVersion} (module ${moduleId})`;
    return {
      capabilities: () => this.gate.granted(),
      readPage: (params) => moduleReadPage(params, { allowedHosts: connectors.networkHosts, userAgent }, moduleId, signal),
      fetch: (params) =>
        moduleFetch(params, {
          allowedHosts: connectors.networkHosts,
          userAgent,
          ...(connectors.testHosts ? { testHosts: connectors.testHosts } : {}),
          // A port that closes (a new one asked for, a reload, the panel closed) ends its requests.
          signal,
        }),
      aiUsage: connectors.aiUsage,
      leaderboards: {
        status: () => connectors.leaderboards.status(),
        show: async () => {
          // Tavora asks in this panel: one click asks once, and not while the panel is over the game.
          await this.gate.enter("leaderboards.show");
          return connectors.leaderboards.show();
        },
        hide: async () => {
          // Deleting the user's results takes their click, so a page can't do it on its own.
          await this.gate.enter("leaderboards.hide");
          return connectors.leaderboards.hide();
        },
        submit: (params) => connectors.leaderboards.submit(params),
        top: (params) => connectors.leaderboards.top(params),
        mine: (params) => connectors.leaderboards.mine(params),
      },
      systemInfo: this.systemInfoFor(page),
      media: this.mediaFor(page),
      discord: this.discordFor(page),
      ...(connectors.folders ? { folders: this.foldersFor(page, connectors.folders) } : {}),
      readOnlyFiles: this.readOnlyFilesFor(page),
      overlay: this.overlayFor(),
      clipboard: {
        writeText: async (text) => {
          // One click copies once, so a page cannot keep the clipboard to itself.
          await this.gate.enter("clipboard.writeText");
          connectors.clipboard.writeText(text);
        },
      },
      hotkeys: {
        list: () => connectors.hotkeys.list(),
        set: async (action, target, label) => {
          // The manifest as installed now (read at the call, not at connect): a reload with a newer copy brings its actions.
          if (!(this.options.module().manifest.actions ?? []).some((item) => item.id === action)) throw new HostError("INVALID_PARAMS", `this module has no action "${action}" in its manifest`);
          // Tavora's dialog takes the key; one click opens it once.
          await this.gate.enter("hotkeys.set");
          return connectors.hotkeys.set(action, target, label);
        },
        remove: (target, action) => connectors.hotkeys.remove(target, action),
      },
    };
  }

  /** The panel was hidden (true) or shown again: its system watch pauses with it. */
  setSuspended(suspended: boolean): void {
    this.systemWatch?.setSuspended(suspended);
  }

  /** The page's port went, or the panel let go of its page: every watch ends, and the Discord hold with them. */
  pageGone(): void {
    this.stopSystemWatch();
    this.stopMediaWatch();
    this.stopFolderWatches();
    this.options.connectors.discord.release(this.options.instanceId);
  }

  /**
   * The module's folders as this panel uses them. Changes reach only this page and only while the grant lasts (a revoke
   * ends a watch at its next change at the latest, and closing the panel ends it at once); like media they keep coming
   * while the panel is hidden, since they are rare and an overlay over the game may need them.
   */
  private foldersFor(page: () => GatePage, folders: FolderHost): NonNullable<BridgeContext["folders"]> {
    return {
      state: (folder) => folders.state(folder),
      list: (folder) => folders.list(folder),
      watch: async (folder, on) => {
        // Only the newest call for a folder counts: a watch that finishes starting after a later on or off is dropped.
        this.folderWatches.get(folder)?.close();
        this.folderWatches.delete(folder);
        if (!on) {
          this.folderTurns.delete(folder);
          return;
        }
        const turn = (this.folderTurns.get(folder) ?? 0) + 1;
        this.folderTurns.set(folder, turn);
        let watcher: FolderWatch | null;
        try {
          watcher = await folders.watch(folder, (change) => {
            if (!this.gate.send(page(), "folders", "folders.changed", change)) this.stopFolderWatches();
          });
        } catch (error) {
          if (this.folderTurns.get(folder) === turn) this.folderTurns.delete(folder);
          throw error;
        }
        if (!watcher) return;
        if (this.gate.live(page()) && this.folderTurns.get(folder) === turn) this.folderWatches.set(folder, watcher);
        else watcher.close();
      },
      choose: async (folder) => {
        // Tavora's folder dialog; one click opens it once, and not while the panel is over the game.
        await this.gate.enter("folders.choose");
        return folders.choose(folder);
      },
      showInFolder: async (folder, file) => {
        // Explorer opens once per click, and not over the game; the file must pass the same checks as a listing.
        await this.gate.enter("folders.showInFolder");
        const target = await folders.reveal(folder, file);
        // Nothing to show, or the panel or the grant went while it was looked up: the same quiet answer.
        if (!target || !this.gate.live(page(), "folders")) return;
        // Only ever selected in its own folder, also the folder a gone file was in: nothing is launched or opened.
        this.options.showItemInFolder(target.path);
      },
    };
  }

  private stopFolderWatches(): void {
    for (const watcher of this.folderWatches.values()) watcher.close();
    this.folderWatches.clear();
  }

  /**
   * Files the user linked to the module (files.pickReadOnly): Tavora's open dialog, after a click, starting next to a
   * linked file or where the game keeps its files. A pick is all or nothing, and the page that asked must still be the
   * panel's once the user chose.
   */
  private readOnlyFilesFor(page: () => GatePage): NonNullable<BridgeContext["readOnlyFiles"]> {
    const { readOnlyFiles } = this.options;
    return {
      pick: async (extensions, multiple, near?: PickNear) => {
        await this.gate.enter("files.pickReadOnly");
        const selected = await this.pickReadOnly(extensions, multiple, near);
        if (!selected.length || !this.gate.live(page())) return [];
        const files = readOnlyFiles();
        const picked: ReadOnlyFile[] = [];
        try {
          for (const path of selected) picked.push(await files.remember(path, () => this.gate.live(page())));
        } catch (error) {
          // All or nothing: a pick that fails part-way leaves no links behind that the module never heard of.
          await Promise.all(picked.map((file) => files.forget(file.id).catch(() => undefined)));
          throw error;
        }
        return picked;
      },
      forget: (id) => readOnlyFiles().forget(id),
      check: (id) => readOnlyFiles().check(id),
      showInFolder: async (id) => {
        await this.gate.enter("files.showInFolder");
        const place = await readOnlyFiles().locate(id);
        if (this.gate.live(page())) this.options.showItemInFolder(place);
      },
    };
  }

  /** Tavora's open dialog for files.pickReadOnly: next to `near` (up to three folders higher), else where the game keeps its files. */
  private async pickReadOnly(extensions: string[], multiple: boolean, near: PickNear | undefined): Promise<string[]> {
    const pick = this.options.pickReadOnly;
    if (!pick) return [];
    const files = this.options.readOnlyFiles();
    const start = (near ? await files.directoryNear(near.file, near.up ?? 0) : undefined) ?? (await saveDialogDirectory(files, this.options.pickGame()));
    return pick({ extensions, multiple, ...(start ? { start } : {}) });
  }

  /**
   * The system-info connector as this panel uses it. Its snapshots reach only this page, only while the grant lasts
   * (a revoke ends the watch at the next snapshot at the latest, and closing the panel ends it at once), and not
   * while the panel is hidden (setSuspended).
   */
  private systemInfoFor(page: () => GatePage): BridgeContext["systemInfo"] {
    const { systemInfo, connection } = this.options.connectors;
    return {
      info: () => systemInfo.info(),
      apps: () => {
        this.gate.check("systemInfo.apps");
        return systemInfo.apps();
      },
      traffic: () => {
        this.gate.check("systemInfo.traffic");
        return systemInfo.traffic();
      },
      watch: (request) => {
        if (!this.systemWatch) {
          this.systemWatch = systemInfo.subscribe({
            snapshot: (snapshot) => {
              if (!this.gate.send(page(), "systemInfo", "systemInfo.snapshot", snapshot)) this.stopSystemWatch();
            },
            drivesChanged: () => {
              this.gate.send(page(), "systemInfo", "systemInfo.drivesChanged", null);
            },
            connectionChanged: (change) => {
              this.gate.send(page(), "systemInfo", "systemInfo.connectionChanged", change);
            },
          });
          if (this.options.suspended()) this.systemWatch.setSuspended(true);
        }
        this.systemWatch.watch(request);
      },
      ...connectionAccess(connection, (what) => this.gate.enter(what)),
    };
  }

  private stopSystemWatch(): void {
    this.systemWatch?.close();
    this.systemWatch = undefined;
  }

  /**
   * The media connector as this panel uses it. Changes reach only this page and only while the grant lasts (a revoke
   * ends the watch at the next change at the latest, and closing the panel ends it at once). Unlike system info they
   * keep coming while the panel is hidden: they are rare and cheap, and a module's overlay over the game or on stream
   * has to stay current while Tavora is behind the game. A control needs a click or key press in the page, or a press
   * of the module's hotkey for that very control (panel-gate.ts MEDIA_HOTKEY_ACTIONS), just before; one press allows one control.
   */
  private mediaFor(page: () => GatePage): BridgeContext["media"] {
    const { media } = this.options.connectors;
    return {
      watch: (on) => {
        if (!on) {
          this.stopMediaWatch();
          return null;
        }
        this.mediaWatch ??= media.subscribe((state) => {
          if (!this.gate.send(page(), "media", "media.changed", state)) this.stopMediaWatch();
        });
        return this.mediaWatch.state();
      },
      control: async (session, action) => {
        if (!this.mediaWatch) return false;
        await this.gate.enter("media.control", { control: action });
        return (await this.mediaWatch?.control(session, action)) ?? false;
      },
    };
  }

  private stopMediaWatch(): void {
    this.mediaWatch?.close();
    this.mediaWatch = undefined;
  }

  /**
   * The discord connector as this panel uses it. Any call but image() makes the panel a user, which
   * keeps the connection running until the page goes; what the connector tells reaches only the page
   * that asked, and only while the grant lasts. Signing in, joining or leaving a channel, and muting or
   * deafening the user need a click or key press in the page first, one per click.
   */
  private discordFor(page: () => GatePage): BridgeContext["discord"] {
    const connector = this.options.connectors.discord;
    const instanceId = this.options.instanceId;
    const listener: DiscordListener = {
      state: (state) => {
        this.gate.send(page(), "discord", "discord.state", state);
      },
      event: (event) => {
        this.gate.send(page(), "discord", "discord.event", event);
      },
    };
    const use = () => connector.use(instanceId, listener);
    return {
      state: async () => (await use(), connector.state()),
      connect: async () => {
        await this.gate.enter("discord.connect");
        await use();
        await connector.connectNow();
      },
      allowControl: async () => {
        await this.gate.enter("discord.allowControl");
        await use();
        await connector.allowControl();
      },
      command: async (command, args) => {
        // Joining or leaving, and muting or deafening the user (which can switch their microphone back on),
        // only follow a click or key press (D8). A person's volume streams while a slider is dragged, and only
        // changes what the user hears, so it needs none.
        if (command === "SELECT_VOICE_CHANNEL" || command === "SET_VOICE_SETTINGS") await this.gate.enter("discord.command", { detail: command });
        await use();
        return connector.command(command, args);
      },
      subscribe: async (event, channelId) => {
        await use();
        await connector.subscribe(instanceId, event, channelId);
      },
      unsubscribe: (event, channelId) => connector.unsubscribe(instanceId, event, channelId),
      image: (url) => connector.image(url),
    };
  }

  /** Overlays of the module in this workspace; what opens a window or the clipboard takes a click (the gate). */
  private overlayFor(): BridgeContext["overlay"] {
    const { overlay } = this.options.connectors;
    return {
      publish: (key, state) => overlay.publish(key, state),
      remove: (key) => overlay.remove(key),
      copyLink: async (key) => {
        // One click copies one link, so a page cannot keep the clipboard to itself.
        await this.gate.enter("overlay.copyLink", { opensWindow: overlay.copyNeedsWindow?.() ?? false });
        return overlay.copyLink(key);
      },
      resetLink: (key) => overlay.resetLink(key),
      showOverGame: async (key) => {
        // One click shows one overlay, so a page cannot keep opening windows over the game.
        await this.gate.enter("overlay.showOverGame");
        return overlay.showOverGame(key);
      },
      hideOverGame: (key) => overlay.hideOverGame(key),
      overGame: () => overlay.overGame(),
      setSources: (sources) => overlay.setSources(sources),
      preview: async (key) => {
        // One click opens one window, so a page cannot keep opening windows.
        await this.gate.enter("overlay.preview");
        return overlay.preview(key);
      },
      openPage: async () => {
        // One click changes the screen once, so a page cannot keep pulling the user away from what they are doing.
        await this.gate.enter("overlay.openPage");
        overlay.openPage();
      },
    };
  }
}
