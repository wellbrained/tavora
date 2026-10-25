import type { DiscordCommand, DiscordEvent, DiscordResult, DiscordState, JsonValue, TavoraSDK } from "@tavora/sdk";
import { TavoraError } from "@tavora/sdk";
import { describe, expect, it, vi } from "vitest";
import { createPanel } from "./panel";

const HASH = "0123456789abcdef0123456789abcdef";
const CONNECTED: DiscordState = { status: "connected", error: null, user: { id: "1", name: "Robin" }, canControl: true, canSaveSignIn: true };
const ok = (data: unknown): DiscordResult => ({ ok: true, data: data as JsonValue });
const person = (id: string, name: string, voice: Record<string, boolean> = {}) => ({
  nick: null,
  voice_state: { mute: false, deaf: false, self_mute: false, self_deaf: false, ...voice },
  user: { id, username: name.toLowerCase(), global_name: name, avatar: id === "1" ? HASH : null },
});

/** An SDK with the discord connector, settings and the overlay calls; Robin has a picture, Lena is muted. */
function fakeSdk() {
  const app = new Map<string, JsonValue>();
  const game = new Map<string, JsonValue>();
  const store = (map: Map<string, JsonValue>) => ({
    get: async (key: string) => (map.has(key) ? structuredClone(map.get(key)!) : null),
    set: async (key: string, value: JsonValue) => void map.set(key, structuredClone(value)),
    delete: async (key: string) => void map.delete(key),
    keys: async () => [...map.keys()],
  });
  let inCall = true;
  let onState: (state: DiscordState) => void = () => {};
  let onEvent: (event: DiscordEvent) => void = () => {};
  const discord = {
    state: vi.fn(async () => CONNECTED),
    onStateChange: (fn: typeof onState) => ((onState = fn), () => {}),
    onEvent: (fn: typeof onEvent) => ((onEvent = fn), () => {}),
    command: async (command: DiscordCommand, args: Record<string, unknown>): Promise<DiscordResult> => {
      if (command === "GET_SELECTED_VOICE_CHANNEL" && !inCall) return ok(null);
      if (command === "GET_SELECTED_VOICE_CHANNEL") return ok({ id: "10", guild_id: "20", name: "Factory Floor", voice_states: [person("1", "Robin"), person("2", "Lena", { self_mute: true })] });
      if (command === "GET_GUILD") return ok({ id: args.guild_id, name: "Crew" });
      return ok({});
    },
    subscribe: async () => {},
    unsubscribe: async () => {},
    image: vi.fn(async (url: string) => `data:image/png;base64,${url.length}`),
  };
  const overGame = new Set<string>();
  let suspend: () => void = () => {};
  let resume: () => void = () => {};
  const published: { key: string; state: any }[] = [];
  const removed: string[] = [];
  const overlay = {
    publish: vi.fn(async (key: string, state: any) => void published.push({ key, state: structuredClone(state) })),
    remove: vi.fn(async (key: string) => void removed.push(key)),
    preview: vi.fn(async () => {}),
    copyLink: vi.fn(async () => "copied" as string),
    showOverGame: vi.fn(async () => {
      overGame.add("voice");
      return "shown" as string;
    }),
    hideOverGame: vi.fn(async (key: string) => void overGame.delete(key)),
    overGame: vi.fn(async () => [...overGame]),
  };
  const lifecycle = {
    onSuspend: (fn: () => void) => (suspend = fn, () => {}),
    onResume: (fn: () => void) => (resume = fn, () => {}),
  };
  const sdk = { storage: { ...store(game), app: store(app) }, connectors: { discord }, overlay, lifecycle } as unknown as TavoraSDK;
  return { sdk, overlay, discordNotInCall: () => void (inCall = false), suspend: () => suspend(), resume: () => resume(), overGame, published, removed, setState: (next: DiscordState) => onState(next), dispatch: (event: DiscordEvent["event"], data: unknown) => onEvent({ event, data: data as JsonValue }) };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** A started panel whose publish throttle is run by hand and whose clock is set by hand. */
async function started() {
  const fake = fakeSdk();
  const timers: (() => void)[] = [];
  let clock = 1_000_000;
  const panel = createPanel(fake.sdk, {
    setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => undefined,
    publishTimer: (fn) => (timers.push(fn), 0 as unknown as ReturnType<typeof setTimeout>),
    shrink: async (source) => `data:image/webp;base64,tiny${source.length}`,
    now: () => clock,
  });
  await panel.start();
  await settle();
  const flush = () => {
    while (timers.length) timers.shift()!();
  };
  return { ...fake, panel, timers, flush, tick: (ms: number) => (clock += ms) };
}

describe("Discord voice overlay", () => {
  it("publishes who is in the channel with a tiny picture, names and flags", async () => {
    const { published, flush } = await started();
    flush();
    const last = published.at(-1)!;
    expect(last.key).toBe("voice");
    expect(last.state.names).toBe(true);
    expect(last.state.people.map((p: any) => [p.n, p.a ? "picture" : "initials", p.m === 1])).toEqual([["Robin", "picture", false], ["Lena", "initials", true]]);
  });

  it("publishes at most every 200 ms and sends the latest state, once", async () => {
    const { published, flush, dispatch, timers, tick } = await started();
    flush();
    const before = published.length;
    // Talking flickers: many events inside one window go out as one publish, with the final state.
    for (let i = 0; i < 5; i++) {
      dispatch("SPEAKING_START", { channel_id: "10", user_id: "2" });
      dispatch("SPEAKING_STOP", { channel_id: "10", user_id: "2" });
    }
    dispatch("SPEAKING_START", { channel_id: "10", user_id: "2" });
    await settle();
    expect(timers.length).toBe(1);
    tick(50);
    flush();
    expect(published.length).toBe(before + 1);
    expect(published.at(-1)!.state.people[1].s).toBe(1);
    // Nothing changed: nothing is sent again.
    dispatch("SPEAKING_START", { channel_id: "10", user_id: "2" });
    await settle();
    flush();
    expect(published.length).toBe(before + 1);
  });

  it("shows nothing when the player is in no voice channel", async () => {
    const { removed, flush, setState } = await started();
    flush();
    setState({ status: "not-running", error: null, user: null, canControl: false, canSaveSignIn: false } as DiscordState);
    await settle();
    flush();
    expect(removed).toEqual(["voice"]);
  });

  it("leaves names off the overlay when the player turned them off", async () => {
    const { panel, published, flush } = await started();
    flush();
    await panel.setOverlayNames(false);
    await settle();
    flush();
    expect(published.at(-1)!.state.people.every((p: any) => !("n" in p))).toBe(true);
    expect(panel.overlay.value.names).toBe(false);
  });

  it("handles Over game: shown, off and full, and turning it off, reading the switch from Tavora", async () => {
    const { panel, overlay, overGame } = await started();
    expect(panel.overlay.value.overGame).toBe(false);
    expect(await panel.setOverGame(true)).toBe("shown");
    expect(overlay.showOverGame).toHaveBeenCalledWith("voice");
    expect(panel.overlay.value.overGame).toBe(true);
    expect(await panel.setOverGame(false)).toBe("removed");
    expect(overlay.hideOverGame).toHaveBeenCalledWith("voice");
    expect(panel.overlay.value.overGame).toBe(false);
    overlay.showOverGame.mockResolvedValueOnce("off");
    expect(await panel.setOverGame(true)).toBe("off");
    expect(panel.overlay.value.overGame).toBe(false);
    overlay.showOverGame.mockResolvedValueOnce("full");
    expect(await panel.setOverGame(true)).toBe("full");
    expect(panel.overlay.value.overGame).toBe(false);
  });

  it("reads the Over game switch again on resume", async () => {
    const { panel, overGame, resume } = await started();
    overGame.add("voice");
    resume();
    await settle();
    expect(panel.overlay.value.overGame).toBe(true);
    overGame.clear();
    resume();
    await settle();
    expect(panel.overlay.value.overGame).toBe(false);
  });

  it("clears every talking flag when the panel suspends, and talks again on resume", async () => {
    const { published, flush, dispatch, suspend, resume } = await started();
    dispatch("SPEAKING_START", { channel_id: "10", user_id: "2" });
    await settle();
    flush();
    expect(published.at(-1)!.state.people[1].s).toBe(1);
    suspend();
    expect(published.at(-1)!.state.people.some((p: any) => p.s)).toBe(false);
    resume();
    await settle();
    flush();
    expect(published.at(-1)!.state.people[1].s).toBe(1);
  });

  it("previews a sample when in no voice channel, until you join or 30 seconds pass", async () => {
    const fake = fakeSdk();
    const timers: (() => void)[] = [];
    const later: (() => void)[] = [];
    const panel = createPanel(fake.sdk, {
      setTimer: (fn) => (later.push(fn), 0 as unknown as ReturnType<typeof setTimeout>),
      clearTimer: () => undefined,
      publishTimer: (fn) => (timers.push(fn), 0 as unknown as ReturnType<typeof setTimeout>),
      shrink: async () => null,
      now: () => 1_000_000,
    });
    const flush = () => {
      while (timers.length) timers.shift()!();
    };
    fake.discordNotInCall();
    await panel.start();
    await settle();
    flush();
    expect(fake.published).toEqual([]);
    await panel.previewOverlay();
    flush();
    const sample = fake.published.at(-1)!.state;
    expect(sample.people.map((p: any) => [p.n, p.i, p.s === 1, p.m === 1])).toEqual([["Alex", "AL", true, false], ["Sam", "SA", false, true]]);
    // The 30 seconds run out: the sample goes.
    fake.removed.length = 0;
    later.at(-1)!();
    flush();
    expect(fake.removed).toEqual(["voice"]);
  });

  it("replaces the sample with the real state when you join a channel", async () => {
    const { published, flush, panel, setState } = await started();
    flush();
    setState({ status: "not-running", error: null, user: null, canControl: false, canSaveSignIn: false } as DiscordState);
    await settle();
    flush();
    await panel.previewOverlay();
    flush();
    expect(published.at(-1)!.state.people[0].n).toBe("Alex");
    setState(CONNECTED);
    await settle();
    flush();
    expect(published.at(-1)!.state.people[0].n).toBe("Robin");
  });

  it("previews, copies the link, and says when the player did not allow it", async () => {
    const { panel, overlay } = await started();
    await panel.previewOverlay();
    expect(overlay.preview).toHaveBeenCalledWith("voice");
    expect(await panel.copyOverlayLink()).toBe("copied");
    overlay.copyLink.mockRejectedValueOnce(new TavoraError({ code: "PERMISSION_DENIED", message: "no", capability: "overlay" }) as never);
    expect(await panel.copyOverlayLink()).toBe("denied");
  });
});
