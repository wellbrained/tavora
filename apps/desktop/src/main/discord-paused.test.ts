// Discord voice is paused (shared/discord-voice.ts, the owner's decision of 2026-11-14): the connector the host makes
// (main/host.ts discordConnector, which says nothing about pausing) never reaches the Discord app or Discord's servers,
// whatever panels and the user ask, and leaves the saved sign-in and what old panels kept as they are.
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));
import { DISCORD_VOICE_PAUSED, isVoicePaused } from "../shared/discord-voice";
import { DiscordConnector, type DiscordDeps } from "./discord";
import type { DiscordSecrets } from "./discord-store";
import type { Installed } from "./installed-modules";
import { overlayModules } from "./overlay-wiring";

const SAVED: DiscordSecrets = {
  token: { accessToken: "good", refreshToken: "r", expiresAt: Date.now() + 1e9 },
  last: { guildId: "20", channelId: "10", name: "Factory Floor", serverName: null },
};

function connector(extra: Partial<DiscordDeps> = {}) {
  const connect = vi.fn<DiscordDeps["connect"]>(async () => null);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 500 }));
  const save = vi.fn<DiscordDeps["save"]>(async () => undefined);
  const timers = vi.fn<NonNullable<DiscordDeps["setTimer"]>>(() => 0 as unknown as ReturnType<typeof setTimeout>);
  const made = new DiscordConnector({
    clientId: "99",
    connect,
    fetch,
    load: async () => structuredClone(SAVED),
    save,
    canSaveSignIn: true,
    onChange: () => undefined,
    setTimer: timers,
    clearTimer: () => undefined,
    ...extra,
  });
  return { made, connect, fetch, save, timers };
}

describe("the Discord voice switch", () => {
  it("covers the catalog Discord module, its development copy and the official one it replaced", () => {
    expect(isVoicePaused("wellbrained.discord", true)).toBe(true);
    expect(isVoicePaused("local.discord", true)).toBe(true);
    expect(isVoicePaused("tavora.discord", true)).toBe(true);
    expect(isVoicePaused("wellbrained.ai-usage", true)).toBe(false);
    expect(isVoicePaused("local.test.discord-probe", true)).toBe(false);
    // The switch flipped: nothing is paused.
    expect(isVoicePaused("wellbrained.discord", false)).toBe(false);
  });
});

// While the switch is on: the connector the host makes, and what the overlays see of the Discord module.
describe.runIf(DISCORD_VOICE_PAUSED)("Discord voice, paused", () => {
  it("never starts the connection to the Discord app, however it's asked", async () => {
    const { made, connect, fetch, timers } = connector();
    const states: unknown[] = [];
    await made.use("p1", { state: (state) => void states.push(state), event: () => undefined });
    await made.connectNow();
    await made.allowControl();
    await made.subscribe("p1", "VOICE_CHANNEL_SELECT", null);
    expect(await made.command("GET_SELECTED_VOICE_CHANNEL", {})).toMatchObject({ ok: false, reason: "not-connected" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(connect).not.toHaveBeenCalled();
    expect(timers).not.toHaveBeenCalled();
    expect(made.view().status).toBe("off");
    // No picture is fetched from Discord's image server either.
    expect(await made.image("https://cdn.discordapp.com/avatars/1/0123456789abcdef0123456789abcdef.png")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    made.release("p1");
    made.dispose();
  });

  it("keeps the saved sign-in and still hands old panels' data to the Discord module", async () => {
    const { made, save, connect } = connector();
    await made.signOut();
    expect(save).not.toHaveBeenCalled();
    // The move at start (main/host.ts moveDiscordPanelData) still reads what old panels kept.
    expect(await made.legacyPanelData()).toEqual({ last: SAVED.last, games: {} });
    expect(connect).not.toHaveBeenCalled();
    made.dispose();
  });

  it("shows no overlay page of the Discord module, and leaves other modules' alone", () => {
    const module = (id: string) => ({ owner: "k", root: "/m", manifest: { id, name: id, overlay: "overlay.html" } });
    const installed = { shown: (id: string) => module(id), get: (id: string) => module(id) } as unknown as Installed;
    const seen = overlayModules(installed);
    expect(seen.shown("wellbrained.discord")).toMatchObject({ owner: "k", manifest: { name: "wellbrained.discord" } });
    expect(seen.shown("wellbrained.discord")?.manifest).not.toHaveProperty("overlay");
    expect(seen.shown("tavora.notes")?.manifest.overlay).toBe("overlay.html");
  });

  it("connects again once it isn't paused", async () => {
    const { made, connect } = connector({ paused: false });
    await made.use("p1", { state: () => undefined, event: () => undefined });
    await made.connectNow();
    await vi.waitFor(() => expect(connect).toHaveBeenCalled());
    made.dispose();
  });
});
