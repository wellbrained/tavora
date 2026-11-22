/**
 * The panel gate: whether a panel's page may make a gated call now. Every call that needs the user's grant, a click or
 * key press, Tavora's own window, the panel in sight or Tavora's own System Monitor says so once, in GATED_CALLS; the
 * bridge checks the grant (`checkGrant`) and each panel's PanelGate the rest, in one order for every call. What a
 * connector tells a panel reaches its page through the gate too (`send`): only the panel's live page, and only while
 * the grant lasts.
 *
 * The press itself (one click or key press allows one call) is shared with the addresses the module's session answers
 * (module-view.ts `SessionGesture`), so a press used here is used there too.
 */
import type { CallName, Capability, EventName, Events, MediaAction } from "@tavora/sdk/protocol";
import { HostError } from "./errors";
import { onlySystemMonitor } from "./system-apps";

/** How long after a click or key press a gated call may be made. */
export const GESTURE_MS = 2_000;
/**
 * How long a call that needs a click waits for it. The preload reports clicks on another channel than
 * the bridge, so the report can land just after the call the click made.
 */
const GESTURE_LATE_MS = 250;
/**
 * The hotkey actions that control media, and the one control each allows: a module's actions with these ids (manifest
 * `actions`). A press of any other of its hotkeys allows none, whatever the module does with it.
 */
export const MEDIA_HOTKEY_ACTIONS: Readonly<Record<string, MediaAction>> = { "play-pause": "playPause", next: "next", previous: "previous" };

/** What a gated call needs before it does anything. The gate checks them in this order; each refusal is PERMISSION_DENIED. */
export interface CallNeeds {
  /** The capability the user granted the module's owner (G9), asked on every call before anything else (bridge.ts). */
  grant?: Capability;
  /** The grant is asked only once the params are checked (a bad call is INVALID_PARAMS with or without the grant). */
  grantAfterParams?: true;
  /** Only Tavora's own System Monitor (publisher official, id tavora.system-monitor), with the grant or without. */
  systemMonitor?: true;
  /** Not while the panel runs only with its game, out of sight: refused, and nobody is told. */
  inSight?: true;
  /**
   * Tavora's own window (a dialog, a menu, a picker, another panel): not while the panel is over the game, and the user
   * is told once per press to bring it back. `"when-it-opens-one"`: only when the call would open one now.
   */
  window?: true | "when-it-opens-one";
  /**
   * A click or key press in the page, one per call. `"sometimes"`: only for what the method names (a pinned tooltip,
   * opening the dialog, maximizing, joining a voice channel or muting); `"or-media-hotkey"`: or a press of the module's
   * hotkey for that very media control (MEDIA_HOTKEY_ACTIONS).
   */
  press?: true | "sometimes" | "or-media-hotkey";
}

/** A call that is clicked for: it can't be made while the panel runs out of sight with its game. */
const clicked = { inSight: true, press: true } as const;
/** A click that opens something of Tavora's own over the workspace. */
const windowed = { inSight: true, window: true, press: true } as const;

/**
 * Every gated call and what it needs. A call not listed needs nothing of these (it may still check its params, or
 * reach only the module's own data). gesture-table.test.ts holds the presses to the SDK's METHOD_INFO, and
 * panel-gate.test.ts the whole table to what each call needed before the gate (pinned).
 */
export const GATED_CALLS = {
  // Folders on this PC: the folder named is checked before the grant.
  "folders.state": { grant: "folders", grantAfterParams: true },
  "folders.list": { grant: "folders", grantAfterParams: true },
  "folders.watch": { grant: "folders", grantAfterParams: true },
  "folders.choose": { grant: "folders", grantAfterParams: true, ...windowed },
  "folders.showInFolder": { grant: "folders", grantAfterParams: true, ...windowed },
  // Files the user linked: no grant, the pick is the user's.
  "files.pickReadOnly": windowed,
  "files.showInFolder": windowed,

  // Without any granted host the answer is the same as for every other capability not granted (G9).
  "network.readPage": { grant: "network" },
  "network.fetch": { grant: "network" },

  "aiUsage.accounts": { grant: "aiUsage" },
  "aiUsage.read": { grant: "aiUsage" },

  "systemInfo.info": { grant: "systemInfo" },
  "systemInfo.watch": { grant: "systemInfo" },
  "systemInfo.connectionLog": { grant: "systemInfo" },
  "systemInfo.connectionSettings": { grant: "systemInfo" },
  "systemInfo.clearConnectionLog": { grant: "systemInfo", systemMonitor: true, ...clicked },
  "systemInfo.setConnectionSettings": { grant: "systemInfo", systemMonitor: true, ...clicked },
  "systemInfo.apps": { grant: "systemInfo", systemMonitor: true },
  "systemInfo.traffic": { grant: "systemInfo", systemMonitor: true },

  "media.watch": { grant: "media" },
  "media.control": { grant: "media", inSight: true, press: "or-media-hotkey" },

  "leaderboards.status": { grant: "leaderboards" },
  "leaderboards.show": { grant: "leaderboards", ...windowed },
  "leaderboards.hide": { grant: "leaderboards", ...clicked },
  "leaderboards.submit": { grant: "leaderboards" },
  "leaderboards.top": { grant: "leaderboards" },
  "leaderboards.mine": { grant: "leaderboards" },

  "discord.state": { grant: "discord" },
  "discord.connect": { grant: "discord", ...clicked },
  "discord.allowControl": { grant: "discord", ...clicked },
  "discord.command": { grant: "discord", inSight: true, press: "sometimes" },
  "discord.subscribe": { grant: "discord" },
  "discord.unsubscribe": { grant: "discord" },
  "discord.image": { grant: "discord" },

  // overlay.copyLink asks for its connector on request (streaming.ts), after the press: so no grant here.
  "overlay.copyLink": { inSight: true, window: "when-it-opens-one", press: true },
  "overlay.resetLink": { grant: "overlay" },
  "overlay.showOverGame": windowed,
  "overlay.preview": windowed,
  "overlay.openPage": windowed,

  "hotkeys.set": windowed,
  "links.open": windowed,
  "panels.open": windowed,
  "panels.openMany": windowed,
  "panel.setMaximized": { inSight: true, window: true, press: "sometimes" },
  "panel.setDialog": { inSight: true, press: "sometimes" },
  "ui.showMenu": windowed,
  "ui.tooltip.show": { inSight: true, press: "sometimes" },
} as const satisfies Partial<Record<CallName, CallNeeds>>;

export type GatedCall = keyof typeof GATED_CALLS;
/** The calls the bridge asks the grant of. */
export type GrantedCall = { [K in GatedCall]: (typeof GATED_CALLS)[K] extends { grant: Capability } ? K : never }[GatedCall];

const needsOf = (call: string): CallNeeds | undefined => (Object.hasOwn(GATED_CALLS, call) ? (GATED_CALLS as Record<string, CallNeeds>)[call] : undefined);

/** Refuses a call whose capability the user has not granted (G9). Asked on every call, so a revoke takes effect at once. */
export function checkGrant(call: GrantedCall, granted: ReadonlySet<Capability>): void {
  const capability = needsOf(call)!.grant!;
  if (!granted.has(capability)) throw new HostError("PERMISSION_DENIED", `${call} needs the "${capability}" permission`, { capability });
}

/** Whether `call` is asked its grant only after its params (CallNeeds.grantAfterParams). */
export const grantAfterParams = (call: GrantedCall): boolean => needsOf(call)!.grantAfterParams === true;

/** What the user has granted a module's owner now, as capabilities (grants.ts): each asked again on every call. */
export function grantedCapabilities(granted: { networkHosts(): ReadonlySet<string>; connectors(): ReadonlySet<string>; folders?: { granted(): boolean } }): ReadonlySet<Capability> {
  const capabilities = new Set<Capability>();
  if (granted.networkHosts().size > 0) capabilities.add("network");
  const connectors = granted.connectors();
  if (connectors.has("ai-usage")) capabilities.add("aiUsage");
  if (connectors.has("leaderboards")) capabilities.add("leaderboards");
  if (connectors.has("system-info")) capabilities.add("systemInfo");
  if (connectors.has("media")) capabilities.add("media");
  if (connectors.has("discord")) capabilities.add("discord");
  if (connectors.has("stream-overlay")) capabilities.add("overlay");
  if (granted.folders?.granted()) capabilities.add("folders");
  return capabilities;
}

/**
 * One click or key press in a page. The panel and its session hold the same one, so it allows exactly one call,
 * made through the bridge or through an address the session answers.
 */
export interface Press {
  at: number;
  used: boolean;
}

/** The press is recent and no call has used it yet. */
export function unused(press: Press | null): press is Press {
  return press !== null && !press.used && Date.now() - press.at <= GESTURE_MS;
}

/** A page of the panel that gets events (bridge.ts BridgeSession). */
export interface GatePage {
  emit<E extends EventName>(event: E, data: Events[E]): void;
}

export interface PanelGateOptions {
  /** The module the panel's page runs as. */
  module: { owner: string; manifest: { id: string } };
  /** What the user granted the module's owner now (grantedCapabilities). */
  granted(): ReadonlySet<Capability>;
  /** The panel's page that is connected now, if any: only it hears what the connectors tell. */
  page(): GatePage | undefined;
  /** The panel runs now only because its game runs, out of sight (with-game.ts). */
  runsOnlyWithGame(): boolean;
  /** The panel is over the game now. */
  overGame(): boolean;
  /** A call that needs Tavora's window was refused over the game: the host tells the user (once per press). */
  onNeedsTavora(): void;
}

/** How one call is made (PanelGate.enter). */
export interface EnterAs {
  /** What the refusal names instead of the call, such as the Discord command. */
  detail?: string;
  /** For `window: "when-it-opens-one"`: whether the call opens Tavora's window this time. */
  opensWindow?: boolean;
  /** For `press: "or-media-hotkey"`: the media control asked for, which a press of its own hotkey allows. */
  control?: MediaAction;
}

/** The gate of one panel: its presses, where it is, and its live page. Lives as long as the panel's view. */
export class PanelGate {
  /** The user's last click or key press in the page (reported by the preload from real input only), shared with the session. */
  private press: Press | null = null;
  /** The press whose refusal the user was told about, so one press shows the notice once. */
  private toldFor: Press | null = null;
  /** The last press of one of the module's media hotkeys for this panel (MEDIA_HOTKEY_ACTIONS): it allows that one media.control. */
  private mediaHotkey: { action: MediaAction; at: number } | null = null;
  /** Calls waiting for a click report that is still on its way. */
  private readonly waiters = new Set<() => void>();

  constructor(private readonly options: PanelGateOptions) {}

  /**
   * The user clicked or typed in the page: a new press, which the caller shares with the session. Calls waiting for it
   * go on at once, unless `wake` is false (the page is gone already); then they look again when their wait is over.
   */
  notePress(wake = true): Press {
    this.press = { at: Date.now(), used: false };
    if (wake) for (const done of this.waiters) done();
    return this.press;
  }

  /** The user pressed one of the module's hotkeys: a media one allows its control once (MEDIA_HOTKEY_ACTIONS), any other ends that. */
  noteHotkey(action: string): void {
    // Object.hasOwn: an action id like `constructor` must not find something of Object's.
    const media = Object.hasOwn(MEDIA_HOTKEY_ACTIONS, action) ? MEDIA_HOTKEY_ACTIONS[action] : undefined;
    this.mediaHotkey = media ? { action: media, at: Date.now() } : null;
  }

  /** Uses the last press up, so it allows nothing more, here or through the session that shares it (a closed panel's). */
  usePress(): void {
    if (this.press) this.press.used = true;
  }

  /** The last press, used or not (the session shares it). */
  get lastPress(): Press | null {
    return this.press;
  }

  /** Whether there is a recent press no call has used yet. */
  get pressed(): boolean {
    return unused(this.press);
  }

  /** What the user has granted the module's owner now. */
  granted(): ReadonlySet<Capability> {
    return this.options.granted();
  }

  /** Tells the user once per press that the panel has to come back first. */
  tellNeedsTavora(): void {
    if (this.press !== null && this.toldFor === this.press) return;
    this.toldFor = this.press;
    this.options.onNeedsTavora();
  }

  /**
   * Whether the call may be made where the panel is now (CallNeeds: systemMonitor, inSight, window); throws
   * PERMISSION_DENIED otherwise. Takes no press: for the checks a call makes before it waits, or a call that needs none.
   */
  check(call: GatedCall, as: EnterAs = {}): void {
    const needs: CallNeeds = GATED_CALLS[call];
    const named = as.detail ?? call;
    if (needs.systemMonitor) onlySystemMonitor(this.options.module.owner, this.options.module.manifest.id, call);
    if (needs.inSight && this.options.runsOnlyWithGame()) throw new HostError("PERMISSION_DENIED", `${named} is not available while the panel runs with its game, out of sight`);
    if (needs.window === true || (needs.window === "when-it-opens-one" && as.opensWindow)) {
      if (!this.options.overGame()) return;
      this.tellNeedsTavora();
      throw new HostError("PERMISSION_DENIED", `${call} is not available while the panel is shown over the game; bring it back first`);
    }
  }

  /**
   * Lets the call through now: `check`, then the press it needs, which it uses up. Waits a moment first for a press
   * whose report has not arrived yet. A media control that its own hotkey was just pressed for needs neither.
   */
  async enter(call: GatedCall, as: EnterAs = {}): Promise<void> {
    const needs: CallNeeds = GATED_CALLS[call];
    const hotkey = this.mediaHotkey;
    if (needs.press === "or-media-hotkey" && as.control !== undefined && hotkey?.action === as.control && Date.now() - hotkey.at <= GESTURE_MS) {
      this.mediaHotkey = null;
      return;
    }
    this.check(call, as);
    if (!needs.press) return;
    if (!unused(this.press)) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, GESTURE_LATE_MS);
        this.waiters.add(done);
      });
    }
    const press = this.press;
    if (!unused(press)) throw new HostError("PERMISSION_DENIED", `${as.detail ?? call} must be called right after a click or key press`);
    press.used = true;
  }

  /** Whether `page` is still the panel's page, and (with `grant`) the grant still holds: what a call checks again after it waited. */
  live(page: GatePage, grant?: Capability): boolean {
    return this.options.page() === page && (grant === undefined || this.options.granted().has(grant));
  }

  /** Tells `page` what a connector said, only while it is the panel's page and the grant lasts; false when it was not told. */
  send<E extends EventName>(page: GatePage, grant: Capability, event: E, data: Events[E]): boolean {
    if (!this.live(page, grant)) return false;
    page.emit(event, data);
    return true;
  }
}
