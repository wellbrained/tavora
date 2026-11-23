import { readFileSync } from "node:fs";
import path from "node:path";
import type { Capability } from "@tavora/sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkGrant, GATED_CALLS, GESTURE_MS, grantAfterParams, grantedCapabilities, PanelGate, type CallNeeds, type GatedCall, type GatePage, type GrantedCall } from "./panel-gate";

/**
 * What every gated call needed before the gate, read from origin/main's bridge.ts (`needs`), module-view.ts
 * (`takeGesture`, `refuseOverGame`, `refuseWithGame`, `onlySystemMonitor`) and connection.ts (`official`, `gesture`) by
 * a script, and pinned here. The gate's table must say exactly this: a difference is a security regression, so change
 * a row only with the call's own change, and say so in its pull request.
 *
 * grantFirst: the grant is asked before the params (false: after them). inSight: refused while the panel runs only with
 * its game. window: refused over the game. press: "some" is for some params only (the method says which).
 */
const BEFORE = {
  "aiUsage.accounts": { grant: "aiUsage", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "aiUsage.read": { grant: "aiUsage", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "discord.allowControl": { grant: "discord", grantFirst: true, systemMonitor: false, inSight: true, window: "never", press: "always" },
  "discord.command": { grant: "discord", grantFirst: true, systemMonitor: false, inSight: true, window: "never", press: "some" },
  "discord.connect": { grant: "discord", grantFirst: true, systemMonitor: false, inSight: true, window: "never", press: "always" },
  "discord.image": { grant: "discord", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "discord.state": { grant: "discord", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "discord.subscribe": { grant: "discord", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "discord.unsubscribe": { grant: "discord", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "files.pickReadOnly": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "files.showInFolder": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "folders.choose": { grant: "folders", grantFirst: false, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "folders.list": { grant: "folders", grantFirst: false, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "folders.showInFolder": { grant: "folders", grantFirst: false, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "folders.state": { grant: "folders", grantFirst: false, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "folders.watch": { grant: "folders", grantFirst: false, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "hotkeys.set": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "leaderboards.hide": { grant: "leaderboards", grantFirst: true, systemMonitor: false, inSight: true, window: "never", press: "always" },
  "leaderboards.mine": { grant: "leaderboards", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "leaderboards.show": { grant: "leaderboards", grantFirst: true, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "leaderboards.status": { grant: "leaderboards", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "leaderboards.submit": { grant: "leaderboards", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "leaderboards.top": { grant: "leaderboards", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "links.open": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "media.control": { grant: "media", grantFirst: true, systemMonitor: false, inSight: true, window: "never", press: "or-media-hotkey" },
  "media.watch": { grant: "media", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "network.fetch": { grant: "network", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "network.readPage": { grant: "network", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "overlay.copyLink": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "when-it-opens-one", press: "always" },
  "overlay.openPage": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "overlay.preview": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "overlay.resetLink": { grant: "overlay", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "overlay.showOverGame": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "panel.setDialog": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "never", press: "some" },
  "panel.setMaximized": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "always", press: "some" },
  "panels.open": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "panels.openMany": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "systemInfo.apps": { grant: "systemInfo", grantFirst: true, systemMonitor: true, inSight: false, window: "never", press: "never" },
  "systemInfo.clearConnectionLog": { grant: "systemInfo", grantFirst: true, systemMonitor: true, inSight: true, window: "never", press: "always" },
  "systemInfo.connectionLog": { grant: "systemInfo", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "systemInfo.connectionSettings": { grant: "systemInfo", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "systemInfo.info": { grant: "systemInfo", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "systemInfo.setConnectionSettings": { grant: "systemInfo", grantFirst: true, systemMonitor: true, inSight: true, window: "never", press: "always" },
  "systemInfo.traffic": { grant: "systemInfo", grantFirst: true, systemMonitor: true, inSight: false, window: "never", press: "never" },
  "systemInfo.watch": { grant: "systemInfo", grantFirst: true, systemMonitor: false, inSight: false, window: "never", press: "never" },
  "ui.showMenu": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "always", press: "always" },
  "ui.tooltip.show": { grant: null, grantFirst: null, systemMonitor: false, inSight: true, window: "never", press: "some" },
};

/** What the connectors told a page before the gate, from the same script: the grant each event needed when sent, and whether a refused one ended the watch. */
const EVENTS_BEFORE = {
  "aiUsage.accountsChanged": { grant: "aiUsage", livePageOnly: false, stopsWatch: false },
  "discord.event": { grant: "discord", livePageOnly: true, stopsWatch: false },
  "discord.state": { grant: "discord", livePageOnly: true, stopsWatch: false },
  "folders.changed": { grant: "folders", livePageOnly: true, stopsWatch: true },
  "media.changed": { grant: "media", livePageOnly: true, stopsWatch: true },
  "systemInfo.connectionChanged": { grant: "systemInfo", livePageOnly: true, stopsWatch: false },
  "systemInfo.drivesChanged": { grant: "systemInfo", livePageOnly: true, stopsWatch: false },
  "systemInfo.snapshot": { grant: "systemInfo", livePageOnly: true, stopsWatch: true },
};

/** A row of the gate's table in BEFORE's words. */
function asBefore(call: GatedCall) {
  const needs: CallNeeds = GATED_CALLS[call];
  return {
    grant: needs.grant ?? null,
    grantFirst: needs.grant ? !grantAfterParams(call as GrantedCall) : null,
    systemMonitor: needs.systemMonitor === true,
    inSight: needs.inSight === true,
    window: needs.window === true ? "always" : (needs.window ?? "never"),
    press: needs.press === true ? "always" : needs.press === "sometimes" ? "some" : (needs.press ?? "never"),
  };
}

describe("the gate's table", () => {
  it("asks every call for what it needed before the gate, no more and no less", () => {
    const after = Object.fromEntries((Object.keys(GATED_CALLS) as GatedCall[]).sort().map((call) => [call, asBefore(call)]));
    expect(after).toEqual(BEFORE);
  });

  it("takes no press for a call that may be made out of sight", () => {
    for (const [call, needs] of Object.entries(GATED_CALLS) as [string, CallNeeds][]) if (needs.press || needs.window) expect(needs.inSight, call).toBe(true);
  });

  it("sends each connector's events only under the grant they were sent under before, to the live page", () => {
    // The connectors' events go through the gate (`send`, or the aiUsage grant for the accounts' change); read from the
    // panel's session, which keeps the watches, and module-view.ts.
    const source = ["panel-session.ts", "module-view.ts"].map((file) => readFileSync(path.join(import.meta.dirname, file), "utf8").replace(/\r\n/g, "\n")).join("\n");
    const lines = source.split("\n");
    const events: Record<string, { grant: string; livePageOnly: boolean; stopsWatch: boolean }> = {};
    for (const line of lines) {
      for (const m of line.matchAll(/(if \(!)?this\.gate\.send\((?:bridge|page)\(\), "(\w+)", "([\w.]+)"/g)) events[m[3]!] = { grant: m[2]!, livePageOnly: true, stopsWatch: m[1] !== undefined && /\) this\.stop\w+\(\);$/.test(line) };
      const any = line.match(/this\.gate\.granted\(\)\.has\("(\w+)"\)\) this\.bridge\?\.emit\("([\w.]+)"/);
      if (any) events[any[2]!] = { grant: any[1]!, livePageOnly: false, stopsWatch: false };
    }
    // And no connector event is sent past the gate.
    expect(source).not.toMatch(/(?:bridge|page)\(\)\.emit\(/);
    expect(Object.fromEntries(Object.keys(events).sort().map((key) => [key, events[key]]))).toEqual(EVENTS_BEFORE);
  });
});

describe("checkGrant", () => {
  it("refuses a call whose capability is not granted, naming it, and lets it through once it is", () => {
    for (const call of Object.keys(GATED_CALLS) as GatedCall[]) {
      const capability = (GATED_CALLS[call] as CallNeeds).grant;
      if (!capability) continue;
      const others = new Set<Capability>(["network", "aiUsage", "systemInfo", "media", "leaderboards", "discord", "overlay", "folders"].filter((other) => other !== capability) as Capability[]);
      expect(() => checkGrant(call as GrantedCall, others), call).toThrowError(expect.objectContaining({ code: "PERMISSION_DENIED", message: `${call} needs the "${capability}" permission`, extra: { capability } }));
      expect(() => checkGrant(call as GrantedCall, new Set([capability])), call).not.toThrow();
    }
  });
});

describe("grantedCapabilities", () => {
  it("names each connector by its capability, the network by any host and folders by their grant, asked anew each time", () => {
    let connectors = new Set(["ai-usage", "leaderboards", "system-info", "media", "discord", "stream-overlay", "something-else"]);
    let hosts = new Set(["api.example.com"]);
    let folders = true;
    const granted = { networkHosts: () => hosts, connectors: () => connectors, folders: { granted: () => folders } };
    expect([...grantedCapabilities(granted)].sort()).toEqual(["aiUsage", "discord", "folders", "leaderboards", "media", "network", "overlay", "systemInfo"]);
    connectors = new Set();
    hosts = new Set();
    folders = false;
    expect([...grantedCapabilities(granted)]).toEqual([]);
    expect([...grantedCapabilities({ networkHosts: () => new Set(), connectors: () => new Set(["media"]) })]).toEqual(["media"]);
  });
});

describe("a panel's gate", () => {
  afterEach(() => vi.useRealTimers());

  function gate(extra: Partial<{ owner: string; id: string; withGame: boolean; overGame: boolean; granted: Capability[] }> = {}) {
    const state = { withGame: extra.withGame ?? false, overGame: extra.overGame ?? false, granted: new Set<Capability>(extra.granted ?? []), page: undefined as GatePage | undefined };
    const told = vi.fn();
    const made = new PanelGate({
      module: { owner: extra.owner ?? "official", manifest: { id: extra.id ?? "tavora.system-monitor" } },
      granted: () => state.granted,
      page: () => state.page,
      runsOnlyWithGame: () => state.withGame,
      overGame: () => state.overGame,
      onNeedsTavora: told,
    });
    return { gate: made, state, told };
  }

  it("lets one press through once, and none older than the window", async () => {
    vi.useFakeTimers();
    const { gate: g } = gate();
    g.notePress();
    await g.enter("links.open");
    const second = expect(g.enter("links.open")).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "links.open must be called right after a click or key press" });
    await vi.advanceTimersByTimeAsync(250);
    await second;
    g.notePress();
    vi.advanceTimersByTime(GESTURE_MS + 1);
    const late = expect(g.enter("links.open")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await vi.advanceTimersByTimeAsync(250);
    await late;
  });

  it("waits a moment for a press whose report is still on its way", async () => {
    vi.useFakeTimers();
    const { gate: g } = gate();
    const waiting = g.enter("ui.showMenu");
    await vi.advanceTimersByTimeAsync(100);
    g.notePress();
    await expect(waiting).resolves.toBeUndefined();
    expect(g.lastPress?.used).toBe(true);
  });

  it("wakes nobody for a press noted after its page went, but lets the wait find it", async () => {
    vi.useFakeTimers();
    const { gate: g } = gate();
    let done = false;
    const waiting = g.enter("ui.showMenu").then(() => (done = true));
    g.notePress(false);
    await vi.advanceTimersByTimeAsync(249);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(done).toBe(true);
  });

  it("names the detail in a refusal instead of the call", async () => {
    vi.useFakeTimers();
    const { gate: g, state } = gate();
    const refused = expect(g.enter("discord.command", { detail: "SELECT_VOICE_CHANNEL" })).rejects.toMatchObject({ message: "SELECT_VOICE_CHANNEL must be called right after a click or key press" });
    await vi.advanceTimersByTimeAsync(250);
    await refused;
    state.withGame = true;
    await expect(g.enter("discord.command", { detail: "SELECT_VOICE_CHANNEL" })).rejects.toMatchObject({ message: "SELECT_VOICE_CHANNEL is not available while the panel runs with its game, out of sight" });
  });

  it("refuses what needs the user while the panel runs out of sight with its game, without telling anyone, and keeps the press", async () => {
    const { gate: g, told } = gate({ withGame: true, overGame: true });
    g.notePress();
    for (const call of Object.keys(GATED_CALLS) as GatedCall[]) {
      if (!(GATED_CALLS[call] as CallNeeds).inSight || (GATED_CALLS[call] as CallNeeds).systemMonitor) continue;
      await expect(g.enter(call), call).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: `${call} is not available while the panel runs with its game, out of sight` });
    }
    expect(told).not.toHaveBeenCalled();
    expect(g.pressed).toBe(true);
  });

  it("refuses what opens Tavora's window over the game, telling the user once per press, and keeps the press", async () => {
    const { gate: g, state, told } = gate({ overGame: true });
    g.notePress();
    await expect(g.enter("ui.showMenu")).rejects.toMatchObject({ message: "ui.showMenu is not available while the panel is shown over the game; bring it back first" });
    await expect(g.enter("folders.choose")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(told).toHaveBeenCalledTimes(1);
    expect(g.pressed).toBe(true);
    g.notePress();
    expect(() => g.check("hotkeys.set")).toThrow();
    expect(told).toHaveBeenCalledTimes(2);
    // What needs no window of Tavora's goes on over the game.
    await expect(g.enter("leaderboards.hide")).resolves.toBeUndefined();
    state.overGame = false;
    g.notePress();
    await expect(g.enter("ui.showMenu")).resolves.toBeUndefined();
  });

  it("refuses a copied link over the game only when it would open a window", async () => {
    const { gate: g } = gate({ overGame: true });
    g.notePress();
    await expect(g.enter("overlay.copyLink", { opensWindow: true })).rejects.toMatchObject({ message: expect.stringContaining("over the game") });
    await expect(g.enter("overlay.copyLink", { opensWindow: false })).resolves.toBeUndefined();
  });

  it("lets only Tavora's own System Monitor change the PC's connection watch or list its apps, even with a press", async () => {
    // From connection.test.ts, "refuses every other module the changes, even with a click", with the apps and traffic.
    const official = ["systemInfo.clearConnectionLog", "systemInfo.setConnectionSettings", "systemInfo.apps", "systemInfo.traffic"] as const;
    for (const [owner, id] of [["local", "local.other"], ["official", "tavora.notes"], ["local", "tavora.system-monitor"], ["a".repeat(64), "tavora.system-monitor"]] as const) {
      const { gate: g } = gate({ owner, id });
      for (const call of official) {
        g.notePress();
        await expect(g.enter(call), `${owner} ${id} ${call}`).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: `${call} is only for Tavora's own System Monitor` });
        expect(g.pressed, call).toBe(true);
      }
    }
    const { gate: monitor } = gate();
    expect(() => monitor.check("systemInfo.apps")).not.toThrow();
    monitor.notePress();
    await expect(monitor.enter("systemInfo.clearConnectionLog")).resolves.toBeUndefined();
  });

  it("checks in one order: the System Monitor, then out of sight, then the window, then the press", async () => {
    const { gate: g, state } = gate({ owner: "local", withGame: true, overGame: true });
    await expect(g.enter("systemInfo.setConnectionSettings")).rejects.toMatchObject({ message: expect.stringContaining("System Monitor") });
    await expect(g.enter("links.open")).rejects.toMatchObject({ message: expect.stringContaining("runs with its game") });
    state.withGame = false;
    await expect(g.enter("links.open")).rejects.toMatchObject({ message: expect.stringContaining("over the game") });
  });

  it("lets a press of the module's own media hotkey allow that one control, once, within the window, even out of sight", async () => {
    vi.useFakeTimers();
    const { gate: g, state } = gate({ withGame: true });
    g.noteHotkey("next");
    await expect(g.enter("media.control", { control: "next" })).resolves.toBeUndefined();
    // Used up: the next one needs a press, which a panel out of sight can't have.
    await expect(g.enter("media.control", { control: "next" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    state.withGame = false;
    g.noteHotkey("play-pause");
    const other = expect(g.enter("media.control", { control: "next" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await vi.advanceTimersByTimeAsync(250);
    await other;
    // The wrong control left the hotkey's own one standing.
    await expect(g.enter("media.control", { control: "playPause" })).resolves.toBeUndefined();
    g.noteHotkey("previous");
    g.noteHotkey("constructor");
    const gone = expect(g.enter("media.control", { control: "previous" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await vi.advanceTimersByTimeAsync(250);
    await gone;
    g.noteHotkey("previous");
    vi.advanceTimersByTime(GESTURE_MS + 1);
    const late = expect(g.enter("media.control", { control: "previous" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await vi.advanceTimersByTimeAsync(250);
    await late;
    // A hotkey allows no other call.
    g.noteHotkey("next");
    const notMedia = expect(g.enter("discord.connect")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await vi.advanceTimersByTimeAsync(250);
    await notMedia;
  });

  it("uses up a closed panel's last press", () => {
    const { gate: g } = gate();
    g.notePress();
    g.usePress();
    expect(g.pressed).toBe(false);
  });

  it("tells only the panel's page, and only while the grant lasts", () => {
    const { gate: g, state } = gate({ granted: ["media"] });
    const page = { emit: vi.fn() };
    const old = { emit: vi.fn() };
    expect(g.send(page, "media", "media.changed", null as never)).toBe(false);
    state.page = page;
    expect(g.send(page, "media", "media.changed", null as never)).toBe(true);
    expect(g.send(old, "media", "media.changed", null as never)).toBe(false);
    expect(g.send(page, "discord", "discord.state", null as never)).toBe(false);
    expect(g.live(page)).toBe(true);
    expect(g.live(page, "folders")).toBe(false);
    state.granted = new Set();
    expect(g.send(page, "media", "media.changed", null as never)).toBe(false);
    expect(g.live(page)).toBe(true);
    expect(page.emit).toHaveBeenCalledTimes(1);
    expect(page.emit).toHaveBeenCalledWith("media.changed", null);
    expect(old.emit).not.toHaveBeenCalled();
  });
});
