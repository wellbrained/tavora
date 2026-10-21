// Settings > Streaming and what modules use of it: Stream overlays (overlays.ts) and hotkeys for module actions
// (hotkeys.ts). The host lends it the library, the installed modules, the game shown now and its panels; this keeps
// the stores, the overlay server, the keys registered with the system and Tavora's hotkey dialog.
import type { ModuleManifest } from "@tavora/module-schema";
import type { HotkeyBinding, HotkeySetResult, JsonValue, OverlayLinkResult } from "@tavora/sdk/protocol";
import type { ActionResult, HotkeyRequestView, StreamingView } from "../shared/host-api";
import { isHotkey } from "../shared/hotkey-keys";
import { translate, type Language } from "../shared/i18n";
import { HostError } from "./errors";
import { HotkeyRegistrar, HotkeyStore, sameBinding, type HotkeyRecord, type ShortcutRegistry } from "./hotkeys";
import { OverlayServer, OverlayStore, overlayUrl, type OverlayLink, type OverlaySubject } from "./overlays";

/** A module as streaming needs it: who owns it, its manifest and the real path of its package. */
export interface StreamingModule {
  owner: string;
  root: string;
  manifest: Pick<ModuleManifest, "id" | "name" | "overlay" | "actions" | "permissions">;
}

/** A panel of the game shown now that hears a hotkey. */
export interface HotkeyListener {
  moduleId: string;
  /** When the player last used the panel; a press goes to the module's panel used last. */
  usedAt: number;
  hotkeyPressed(binding: HotkeyBinding): void;
}

export interface StreamingOptions {
  userData: string;
  settings(): { streamOverlays: boolean; overlayPort: number };
  saveSettings(next: { streamOverlays?: boolean; overlayPort?: number }): void;
  module(moduleId: string): StreamingModule | undefined;
  /** Whether the player granted the module the stream-overlay connector, as it is installed now. */
  overlayGranted(moduleId: string): boolean;
  /** Asks the player in Tavora's consent dialog for a connector the module asks for on request; whether they allowed it. */
  askConnector(moduleId: string, connector: "stream-overlay"): Promise<boolean>;
  /** The game shown now, or null. */
  gameId(): string | null;
  gameName(gameId: string): string | null;
  /** The module panels of the game shown now. */
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

interface PendingHotkey {
  id: number;
  binding: Omit<HotkeyRecord, "label" | "accelerator">;
  label: string;
  error: string | null;
  resolve(result: HotkeySetResult): void;
}

export class Streaming {
  private readonly server: OverlayServer;
  private readonly registrar: HotkeyRegistrar;
  private pending: PendingHotkey | null = null;
  private nextRequest = 1;

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

  // ── What a module panel gets ─────────────────────────────────────────

  /**
   * overlay.* for a panel of `module` in `gameId`; the bridge checked the keys, and the capability for all but copyLink:
   * a module that asks for the connector on request gets Tavora's consent dialog there the first time.
   */
  overlayFor(module: StreamingModule, gameId: string) {
    const subject = (key: string): OverlaySubject => ({ owner: module.owner, moduleId: module.manifest.id, gameId, key });
    const granted = async (): Promise<boolean> => {
      if (this.options.overlayGranted(module.manifest.id)) return true;
      if (!(module.manifest.permissions.onRequest ?? []).includes("stream-overlay")) {
        throw new HostError("PERMISSION_DENIED", 'overlay.copyLink needs the "overlay" permission', { capability: "overlay" });
      }
      return this.options.askConnector(module.manifest.id, "stream-overlay");
    };
    return {
      publish: (key: string, state: JsonValue) => this.overlays.publish(subject(key), state),
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
    };
  }

  /** hotkeys.* for a panel of `module` in `gameId`; the module view checked the action and the click. */
  hotkeysFor(module: StreamingModule, gameId: string) {
    const own = (record: HotkeyRecord) => record.owner === module.owner && record.moduleId === module.manifest.id && record.gameId === gameId;
    return {
      list: (): HotkeyBinding[] => this.hotkeys.of(module.owner, module.manifest.id, gameId).map(({ action, target }) => ({ action, target })),
      set: (action: string, target: string, label: string) => this.ask({ owner: module.owner, moduleId: module.manifest.id, gameId, action, target }, label),
      remove: (target: string, action: string | null) => {
        if (this.hotkeys.remove((record) => own(record) && record.target === target && (action === null || record.action === action))) this.changed();
      },
    };
  }

  // ── The hotkey dialog ────────────────────────────────────────────────

  /** Opens Tavora's hotkey dialog; resolves with what the player did there. Only for the game shown now. */
  private ask(binding: PendingHotkey["binding"], label: string): Promise<HotkeySetResult> {
    if (this.options.gameId() !== binding.gameId) throw new HostError("PERMISSION_DENIED", "hotkeys.set works only in the game shown now");
    this.pending?.resolve("cancelled");
    // Every key goes free while the dialog is open, so it can catch keys set already.
    this.registrar.pause();
    return new Promise<HotkeySetResult>((resolve) => {
      this.pending = { id: this.nextRequest++, binding, label, error: null, resolve };
      this.options.focus();
      this.changed();
    });
  }

  /** The player's answer in the hotkey dialog. A refused key keeps the dialog open with the reason. */
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
      const other = this.hotkeys.conflict(pending.binding, accelerator);
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

  /** The game changed or its panel went away while the dialog was open: it closes. */
  private dropStalePending(): void {
    const pending = this.pending;
    if (pending && (this.options.gameId() !== pending.binding.gameId || !this.options.panels().some((panel) => panel.moduleId === pending.binding.moduleId))) this.close("cancelled");
  }

  // ── Keys registered with the system ──────────────────────────────────

  /**
   * Registers the hotkeys that should work now: the game shown now, modules with a panel in its workspace. Cheap when
   * nothing changed, so the host calls it on every state push.
   */
  sync(): void {
    this.dropStalePending();
    const gameId = this.options.gameId();
    const open = new Set(this.options.panels().map((panel) => panel.moduleId));
    const wanted = gameId === null ? [] : this.hotkeys.all().filter((record) => record.gameId === gameId && open.has(record.moduleId) && this.options.module(record.moduleId)?.owner === record.owner);
    this.registrar.apply(wanted);
  }

  /** One press is one action: it goes to one panel of the module, the one used last, so several panels don't each act on it. */
  private pressed(record: HotkeyRecord): void {
    if (this.options.gameId() !== record.gameId) return;
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

  /** A game left the library for good: its overlay links and hotkeys go too. */
  forgetGame(gameId: string): void {
    this.overlays.forget((link) => link.gameId === gameId);
    this.hotkeys.remove((record) => record.gameId === gameId);
  }

  /** A module's data was deleted: its overlay links and hotkeys go too. */
  forgetModule(owner: string, moduleId: string): void {
    this.overlays.forget((link) => link.owner === owner && link.moduleId === moduleId);
    this.hotkeys.remove((record) => record.owner === owner && record.moduleId === moduleId);
  }

  private actionName(record: Pick<HotkeyRecord, "moduleId" | "action">): string {
    return this.options.module(record.moduleId)?.manifest.actions?.find((action) => action.id === record.action)?.name ?? record.action;
  }

  view(): StreamingView {
    const settings = this.options.settings();
    return {
      overlays: { enabled: settings.streamOverlays, port: settings.overlayPort, status: this.server.status },
      hotkeys: this.hotkeys.all().map((record) => ({
          owner: record.owner,
          gameId: record.gameId,
          gameName: this.options.gameName(record.gameId) ?? record.gameId,
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
      moduleName: this.options.module(pending.binding.moduleId)?.manifest.name ?? pending.binding.moduleId,
      actionName: this.actionName(pending.binding),
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
