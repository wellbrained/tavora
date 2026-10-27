// Settings > Streaming and what modules use of it: Stream overlays (overlays.ts) and hotkeys for module actions
// (hotkeys.ts). The host lends it the library, the installed modules, the workspace shown now and its panels; this keeps
// the stores, the overlay server, the keys registered with the system and Tavora's hotkey dialog.
import type { ModuleManifest } from "@tavora/module-schema";
import type { HotkeyBinding, HotkeySetResult, JsonValue, OverlayLinkResult } from "@tavora/sdk/protocol";
import type { ActionResult, HotkeyRequestView, StreamingView } from "../shared/host-api";
import { isHotkey } from "../shared/hotkey-keys";
import { translate, type Language } from "../shared/i18n";
import { HostError } from "./errors";
import { isOverlayAction } from "./game-overlay-service";
import { HotkeyRegistrar, HotkeyStore, sameBinding, type HotkeyRecord, type ShortcutRegistry } from "./hotkeys";
import { OverlayServer, OverlayStore, overlayUrl, type OverlayLink, type OverlaySubject } from "./overlays";

/** A module as streaming needs it: who owns it, its manifest and the real path of its package. */
export interface StreamingModule {
  owner: string;
  root: string;
  manifest: Pick<ModuleManifest, "id" | "name" | "overlay" | "overlaySize" | "actions" | "permissions">;
}

/** A panel of the workspace shown now that hears a hotkey. */
export interface HotkeyListener {
  moduleId: string;
  /** When the user last used the panel; a press goes to the module's panel used last. */
  usedAt: number;
  hotkeyPressed(binding: HotkeyBinding): void;
}

export interface StreamingOptions {
  userData: string;
  settings(): { streamOverlays: boolean; overlayPort: number };
  saveSettings(next: { streamOverlays?: boolean; overlayPort?: number }): void;
  module(moduleId: string): StreamingModule | undefined;
  /** Whether the user granted the module the stream-overlay connector, as it is installed now. */
  overlayGranted(moduleId: string): boolean;
  /** Asks the user in Tavora's consent dialog for a connector the module asks for on request; whether they allowed it. */
  askConnector(moduleId: string, connector: "stream-overlay"): Promise<boolean>;
  /** The workspace shown now, or null. */
  workspaceId(): string | null;
  workspaceName(workspaceId: string): string | null;
  /** The module panels of the workspace shown now. */
  panels(): HotkeyListener[];
  shortcuts: ShortcutRegistry;
  writeClipboard(text: string): void;
  /** Opens Settings at one of its settings (settings-index.ts). */
  openSetting(setting: string): void;
  /** Brings Tavora's window to the front and gives it the keyboard, for the hotkey dialog. */
  focus(): void;
  language(): Language;
  changed(): void;
}

/** What game overlays need of the hotkeys: which of their keys work now, and what a press does (game-overlay-service.ts). */
export interface OverlayKeys {
  /** The game in front; the keys of game overlays work only while one is. */
  frontGame(): string | null;
  wants(record: HotkeyRecord): boolean;
  /** Whether the user has a game overlay for this key. */
  has(subject: OverlaySubject): boolean;
  pressed(record: HotkeyRecord): void;
  /** Whether the key works over every game (the layer key, a general overlay's key): it collides with any workspace's keys. */
  general(binding: Omit<HotkeyRecord, "label" | "accelerator">): boolean;
}

interface PendingHotkey {
  id: number;
  binding: Omit<HotkeyRecord, "label" | "accelerator">;
  /** For a key of game overlays: the words the dialog uses; the dialog stays open when the workspace shown changes. */
  overlay?: { module: string; action: string };
  label: string;
  error: string | null;
  resolve(result: HotkeySetResult): void;
}

export class Streaming {
  private readonly server: OverlayServer;
  private readonly registrar: HotkeyRegistrar;
  /** The overlay states and links, which game overlays read the same way (game-overlay-service.ts). */
  get overlayStore(): OverlayStore {
    return this.overlays;
  }

  private pending: PendingHotkey | null = null;
  private nextRequest = 1;
  private overlayKeys: OverlayKeys | null = null;

  private constructor(
    private readonly options: StreamingOptions,
    private readonly overlays: OverlayStore,
    private readonly hotkeys: HotkeyStore,
  ) {
    this.server = new OverlayServer({ store: overlays, page: (link) => this.pageOf(link) });
    this.registrar = new HotkeyRegistrar(options.shortcuts, (record) => this.pressed(record));
  }

  static async create(options: StreamingOptions): Promise<Streaming> {
    const streaming = new Streaming(options, await OverlayStore.load(options.userData), await HotkeyStore.load(options.userData));
    if (options.settings().streamOverlays) await streaming.server.start(options.settings().overlayPort);
    return streaming;
  }

  /** The overlay page of a link's module, while it may serve one: installed under the link's owner, with the connector granted. */
  private pageOf(link: OverlayLink): { root: string; entry: string } | null {
    const module = this.options.module(link.moduleId);
    if (!module || module.owner !== link.owner || !module.manifest.overlay || !this.options.overlayGranted(link.moduleId)) return null;
    return { root: module.root, entry: module.manifest.overlay };
  }

  /** Lets game overlays have keys (game-overlay-service.ts); made after Streaming, which it needs. */
  useOverlayKeys(keys: OverlayKeys): void {
    this.overlayKeys = keys;
  }

  // ── What a module panel gets ─────────────────────────────────────────

  /**
   * overlay.* for a panel of `module` in `workspaceId`; the bridge checked the keys, and the capability for resetLink.
   * copyLink needs the connector too: a module that asks for it on request gets Tavora's consent dialog there the first
   * time. publish and remove need no capability: they only set what a link or a game overlay shows.
   */
  overlayFor(module: StreamingModule, workspaceId: string) {
    const subject = (key: string): OverlaySubject => ({ owner: module.owner, moduleId: module.manifest.id, workspaceId, key });
    const granted = async (): Promise<boolean> => {
      if (this.options.overlayGranted(module.manifest.id)) return true;
      if (!(module.manifest.permissions.onRequest ?? []).includes("stream-overlay")) {
        throw new HostError("PERMISSION_DENIED", 'overlay.copyLink needs the "overlay" permission', { capability: "overlay" });
      }
      return this.options.askConnector(module.manifest.id, "stream-overlay");
    };
    return {
      publish: (key: string, state: JsonValue) => {
        // Without the connector nothing reads a link, so state is kept only for a key that a game overlay shows or that
        // has a link already (a link made before the grant was taken back). Otherwise a module could fill the disk.
        const own = subject(key);
        if (this.options.overlayGranted(module.manifest.id) || this.overlays.peek(own) || this.overlayKeys?.has(own)) this.overlays.publish(own, state);
      },
      remove: (key: string) => this.overlays.remove(subject(key)),
      copyLink: async (key: string): Promise<OverlayLinkResult> => {
        if (!(await granted())) return "denied";
        const link = this.overlays.link(subject(key));
        const port = this.server.port;
        if (!this.options.settings().streamOverlays || port === null) {
          this.options.openSetting("stream-overlays");
          return "off";
        }
        this.options.writeClipboard(overlayUrl(port, link.token));
        return "copied";
      },
      resetLink: (key: string) => this.overlays.reset(subject(key)),
      /** Whether copyLink would open Tavora's own window now: the consent dialog, or the setting that is off. */
      copyNeedsWindow: (): boolean =>
        !this.options.overlayGranted(module.manifest.id) || !this.options.settings().streamOverlays || this.server.port === null,
    };
  }

  /** hotkeys.* for a panel of `module` in `workspaceId`; the module view checked the action and the click. */
  hotkeysFor(module: StreamingModule, workspaceId: string) {
    const own = (record: HotkeyRecord) => record.owner === module.owner && record.moduleId === module.manifest.id && record.workspaceId === workspaceId;
    return {
      list: (): HotkeyBinding[] => this.hotkeys.of(module.owner, module.manifest.id, workspaceId).map(({ action, target }) => ({ action, target })),
      set: (action: string, target: string, label: string) => this.ask({ owner: module.owner, moduleId: module.manifest.id, workspaceId, action, target }, label),
      remove: (target: string, action: string | null) => {
        if (this.hotkeys.remove((record) => own(record) && record.target === target && (action === null || record.action === action))) this.changed();
      },
    };
  }

  // ── The hotkey dialog ────────────────────────────────────────────────

  /** Opens Tavora's hotkey dialog; resolves with what the user did there. Only for the workspace shown now. */
  private ask(binding: PendingHotkey["binding"], label: string, overlay?: PendingHotkey["overlay"]): Promise<HotkeySetResult> {
    if (!overlay && this.options.workspaceId() !== binding.workspaceId) throw new HostError("PERMISSION_DENIED", "hotkeys.set works only in the workspace shown now");
    this.pending?.resolve("cancelled");
    // Every key goes free while the dialog is open, so it can catch keys set already.
    this.registrar.pause();
    return new Promise<HotkeySetResult>((resolve) => {
      this.pending = { id: this.nextRequest++, binding, label, error: null, resolve, ...(overlay ? { overlay } : {}) };
      this.options.focus();
      this.changed();
    });
  }

  /** Opens the hotkey dialog for a key of game overlays (Settings > Overlays), which is set for any workspace, not only the one shown. */
  askOverlayKey(binding: PendingHotkey["binding"], label: string, words: { module: string; action: string }): Promise<HotkeySetResult> {
    return this.ask(binding, label, words);
  }

  /** The key set for a binding, and whether another program holds it. */
  keyOf(binding: Omit<HotkeyRecord, "label" | "accelerator">): { accelerator: string; taken: boolean } | null {
    const record = this.hotkeys.find(binding);
    return record ? { accelerator: record.accelerator, taken: this.registrar.taken.has(record.accelerator) } : null;
  }

  /** Takes away the hotkeys matching `test`. */
  removeKeys(test: (record: HotkeyRecord) => boolean): void {
    if (this.hotkeys.remove(test)) this.changed();
  }

  /**
   * Takes away the hotkeys matching `test`; when none is set for `to` yet, the one set last (the last of the file)
   * is given to `to` instead, if no other key uses it. For keys that a newer Tavora replaced by another.
   */
  moveKey(test: (record: HotkeyRecord) => boolean, to: Omit<HotkeyRecord, "label" | "accelerator">): void {
    const last = this.hotkeys.all().filter(test).at(-1);
    const removed = this.hotkeys.remove(test);
    if (last && !this.hotkeys.find(to) && !this.hotkeys.conflict(to, last.accelerator, (key) => this.overlayKeys?.general(key) ?? false)) {
      this.hotkeys.set({ ...to, label: last.label, accelerator: last.accelerator });
      this.changed();
    } else if (removed) this.changed();
  }

  /** The user's answer in the hotkey dialog. A refused key keeps the dialog open with the reason. */
  answer(id: number, choice: "set" | "remove" | "cancel", accelerator?: string): ActionResult {
    const pending = this.pending;
    if (!pending || pending.id !== id) return { ok: true };
    const say = (key: Parameters<typeof translate>[1], params?: Record<string, string>) => translate(this.options.language(), key, params);
    if (choice === "set") {
      if (!isHotkey(accelerator)) {
        pending.error = say("hotkey.unsupported");
        this.changed();
        return { ok: true };
      }
      const other = this.hotkeys.conflict(pending.binding, accelerator, (key) => this.overlayKeys?.general(key) ?? false);
      if (other) {
        pending.error = say("hotkey.inUse", { label: other.label, action: this.actionName(other) });
        this.changed();
        return { ok: true };
      }
      if (this.registrar.isTaken(accelerator)) {
        pending.error = say("hotkey.taken");
        this.changed();
        return { ok: true };
      }
      if (!this.hotkeys.set({ ...pending.binding, label: pending.label, accelerator })) {
        pending.error = say("hotkey.tooMany");
        this.changed();
        return { ok: true };
      }
    } else if (choice === "remove") {
      this.hotkeys.remove((record) => sameBinding(record, pending.binding));
    }
    this.close(choice === "set" ? "set" : choice === "remove" ? "removed" : "cancelled");
    return { ok: true };
  }

  private close(result: HotkeySetResult): void {
    const pending = this.pending;
    this.pending = null;
    this.registrar.resume();
    pending?.resolve(result);
    this.changed();
  }

  /** The workspace changed or its panel went away while the dialog was open: it closes. */
  private dropStalePending(): void {
    const pending = this.pending;
    if (pending && !pending.overlay && (this.options.workspaceId() !== pending.binding.workspaceId || !this.options.panels().some((panel) => panel.moduleId === pending.binding.moduleId))) this.close("cancelled");
  }

  // ── Keys registered with the system ──────────────────────────────────

  /**
   * Registers the hotkeys that should work now: the workspace shown now, modules with a panel in it. Cheap when
   * nothing changed, so the host calls it on every state push.
   */
  sync(): void {
    this.dropStalePending();
    const workspaceId = this.options.workspaceId();
    const open = new Set(this.options.panels().map((panel) => panel.moduleId));
    const wanted = workspaceId === null ? [] : this.hotkeys.all().filter((record) => record.workspaceId === workspaceId && !isOverlayAction(record.action) && open.has(record.moduleId) && this.options.module(record.moduleId)?.owner === record.owner);
    // The keys of game overlays follow the game in front instead, so they take no key from other programs.
    // The layer key is for every game, an overlay's key for its own (or every game, for a general overlay).
    const front = this.overlayKeys?.frontGame() ?? null;
    if (front !== null) wanted.push(...this.hotkeys.all().filter((record) => isOverlayAction(record.action) && this.overlayKeys!.wants(record)));
    this.registrar.apply(wanted);
  }

  /** One press is one action: it goes to one panel of the module, the one used last, so several panels don't each act on it. */
  private pressed(record: HotkeyRecord): void {
    if (isOverlayAction(record.action)) return this.overlayKeys?.pressed(record);
    if (this.options.workspaceId() !== record.workspaceId) return;
    const panel = this.options.panels().filter((item) => item.moduleId === record.moduleId).sort((a, b) => b.usedAt - a.usedAt)[0];
    panel?.hotkeyPressed({ action: record.action, target: record.target });
  }

  private changed(): void {
    this.options.changed();
  }

  // ── Settings > Streaming ─────────────────────────────────────────────

  async setOverlays(enabled: boolean): Promise<void> {
    this.options.saveSettings({ streamOverlays: enabled });
    if (enabled) await this.server.start(this.options.settings().overlayPort);
    else await this.server.stop();
  }

  async setPort(port: number): Promise<void> {
    this.options.saveSettings({ overlayPort: port });
    if (this.options.settings().streamOverlays) await this.server.start(port);
  }

  /** Every overlay link gets a new address; the old ones stop working. */
  resetLinks(): void {
    this.overlays.resetAll();
  }

  removeHotkey(binding: Omit<HotkeyRecord, "label" | "accelerator">): void {
    this.hotkeys.remove((record) => sameBinding(record, binding));
  }

  /** A workspace left the library for good: its overlay links and hotkeys go too. */
  forgetWorkspace(workspaceId: string): void {
    this.overlays.forget((link) => link.workspaceId === workspaceId);
    this.hotkeys.remove((record) => record.workspaceId === workspaceId);
  }

  /** A module's data was deleted: its overlay links and hotkeys go too. */
  forgetModule(owner: string, moduleId: string): void {
    this.overlays.forget((link) => link.owner === owner && link.moduleId === moduleId);
    this.hotkeys.remove((record) => record.owner === owner && record.moduleId === moduleId);
  }

  private actionName(record: Pick<HotkeyRecord, "moduleId" | "action">): string {
    if (isOverlayAction(record.action)) return translate(this.options.language(), record.action === "$layer" ? "overlays.layerAction" : "overlays.toggleAction");
    return this.options.module(record.moduleId)?.manifest.actions?.find((action) => action.id === record.action)?.name ?? record.action;
  }

  view(): StreamingView {
    const settings = this.options.settings();
    return {
      overlays: { enabled: settings.streamOverlays, port: settings.overlayPort, status: this.server.status },
      // The links OBS can use: of modules that may serve one, with the page they show.
      links: this.overlays
        .all()
        .filter((link) => this.pageOf(link) !== null)
        .map((link) => ({
          owner: link.owner,
          moduleId: link.moduleId,
          moduleName: this.options.module(link.moduleId)?.manifest.name ?? link.moduleId,
          workspaceId: link.workspaceId,
          workspaceName: this.options.workspaceName(link.workspaceId) ?? link.workspaceId,
          key: link.key,
        })),
      hotkeys: this.hotkeys.all().filter((record) => !isOverlayAction(record.action)).map((record) => ({
          owner: record.owner,
          workspaceId: record.workspaceId,
          workspaceName: this.options.workspaceName(record.workspaceId) ?? record.workspaceId,
          moduleId: record.moduleId,
          moduleName: this.options.module(record.moduleId)?.manifest.name ?? record.moduleId,
          action: record.action,
          actionName: this.actionName(record),
          target: record.target,
          label: record.label,
          accelerator: record.accelerator,
          taken: this.registrar.taken.has(record.accelerator),
        })),
    };
  }

  request(): HotkeyRequestView | null {
    const pending = this.pending;
    if (!pending) return null;
    const current = this.hotkeys.find(pending.binding)?.accelerator ?? null;
    return {
      id: pending.id,
      moduleName: pending.overlay?.module ?? this.options.module(pending.binding.moduleId)?.manifest.name ?? pending.binding.moduleId,
      actionName: pending.overlay?.action ?? this.actionName(pending.binding),
      label: pending.label,
      current,
      error: pending.error,
    };
  }

  /** Quitting: keys go back to the system, and the last overlay states are written. */
  async shutdown(): Promise<void> {
    this.pending?.resolve("cancelled");
    this.pending = null;
    this.registrar.clear();
    await this.server.stop();
    await this.overlays.save();
  }
}
