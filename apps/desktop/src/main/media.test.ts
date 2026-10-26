import { describe, expect, it } from "vitest";
import type { MediaState } from "@tavora/sdk/protocol";
import { CONTROL_TIMEOUT_MS, IDLE_MS, MAX_RESTARTS, MediaConnector, START_TIMEOUT_MS, type MediaHelper } from "./media";

/** A helper that writes what the test says and remembers what it got. */
class FakeHelper implements MediaHelper {
  readonly written: string[] = [];
  killed = false;
  private line: (line: string) => void = () => {};
  private exit: () => void = () => {};
  onLine(fn: (line: string) => void) {
    this.line = fn;
  }
  onExit(fn: () => void) {
    this.exit = fn;
  }
  write(line: string) {
    this.written.push(line);
  }
  kill() {
    this.killed = true;
    this.exit();
  }
  say(message: unknown) {
    this.line(JSON.stringify(message));
  }
  crash() {
    this.exit();
  }
}

/** Timers the test runs by hand. */
function clock() {
  let now = 1_000_000;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (id: unknown) => {
      timers = timers.filter((t) => t.id !== id);
    },
    advance(ms: number) {
      now += ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        due.fn();
      }
    },
  };
}

const SESSION = {
  id: "Spotify.exe#0",
  app: "Spotify.exe",
  current: true,
  title: "Song",
  artist: "Artist",
  album: "Album",
  status: "playing",
  positionMs: 1000,
  positionAt: 1_000_000,
  durationMs: 200_000,
  canPlayPause: true,
  canNext: true,
  canPrevious: true,
  coverKey: "k1",
};

function setup(options: { unavailable?: boolean } = {}) {
  const time = clock();
  const helpers: FakeHelper[] = [];
  const logs: string[] = [];
  const connector = new MediaConnector({
    start: () => {
      if (options.unavailable) return null;
      const helper = new FakeHelper();
      helpers.push(helper);
      return helper;
    },
    cover: (bytes) => (bytes.length ? `data:image/jpeg;base64,${bytes.toString("base64")}` : null),
    log: (message) => void logs.push(message),
    setTimeout: time.setTimeout,
    clearTimeout: time.clearTimeout,
    now: time.now,
  });
  const seen: MediaState[] = [];
  return { time, helpers, logs, connector, seen, listen: () => connector.subscribe((state) => void seen.push(state)) };
}

describe("MediaConnector", () => {
  it("starts the helper for the first panel and passes sessions on with a readable app name", () => {
    const { helpers, listen, seen } = setup();
    const sub = listen();
    expect(helpers).toHaveLength(1);
    expect(sub.state()).toEqual({ state: "starting", sessions: [] });
    helpers[0]!.say({ type: "ready" });
    helpers[0]!.say({ type: "sessions", sessions: [SESSION] });
    expect(seen.at(-1)).toEqual({
      state: "ready",
      sessions: [
        {
          id: "Spotify.exe#0",
          app: { id: "Spotify.exe", name: "Spotify" },
          current: true,
          title: "Song",
          artist: "Artist",
          album: "Album",
          status: "playing",
          positionMs: 1000,
          positionAt: 1_000_000,
          durationMs: 200_000,
          cover: null,
          can: { playPause: true, next: true, previous: true },
        },
      ],
    });
  });

  it("shares one helper between panels", () => {
    const { helpers, listen } = setup();
    listen();
    listen();
    expect(helpers).toHaveLength(1);
  });

  it("adds the cover once it comes, and only for the song playing", () => {
    const { helpers, listen, seen } = setup();
    listen();
    const helper = helpers[0]!;
    helper.say({ type: "sessions", sessions: [SESSION] });
    helper.say({ type: "cover", id: "Spotify.exe#0", key: "old song", mime: "image/png", data: "AAAA" });
    expect(seen.at(-1)!.sessions[0]!.cover).toBeNull();
    helper.say({ type: "cover", id: "Spotify.exe#0", key: "k1", mime: "image/png", data: "AAAA" });
    expect(seen.at(-1)!.sessions[0]!.cover).toBe("data:image/jpeg;base64,AAAA");
    helper.say({ type: "sessions", sessions: [{ ...SESSION, title: "Next", coverKey: "k2" }] });
    expect(seen.at(-1)!.sessions[0]!.cover).toBeNull();
  });

  it("ends the helper a minute after the last panel stops", () => {
    const { helpers, listen, time, connector } = setup();
    const a = listen();
    const b = listen();
    helpers[0]!.say({ type: "ready" });
    a.close();
    time.advance(IDLE_MS * 2);
    expect(helpers[0]!.killed).toBe(false);
    b.close();
    time.advance(IDLE_MS - 1);
    expect(connector.running).toBe(true);
    time.advance(1);
    expect(helpers[0]!.killed).toBe(true);
    expect(connector.running).toBe(false);
  });

  it("keeps the helper when a panel comes back within the minute", () => {
    const { helpers, listen, time } = setup();
    const first = listen();
    helpers[0]!.say({ type: "ready" });
    first.close();
    time.advance(IDLE_MS / 2);
    listen();
    time.advance(IDLE_MS * 2);
    expect(helpers).toHaveLength(1);
    expect(helpers[0]!.killed).toBe(false);
  });

  it("restarts a crashed helper, then gives up until a panel starts watching again", () => {
    const { helpers, listen, seen, logs } = setup();
    listen();
    for (let i = 0; i < MAX_RESTARTS; i++) helpers.at(-1)!.crash();
    expect(helpers).toHaveLength(MAX_RESTARTS + 1);
    helpers.at(-1)!.crash();
    expect(helpers).toHaveLength(MAX_RESTARTS + 1);
    expect(seen.at(-1)).toEqual({ state: "failed", sessions: [] });
    expect(logs.at(-1)).toMatch(/keeps stopping/);
    listen();
    expect(helpers).toHaveLength(MAX_RESTARTS + 2);
    expect(seen.at(-1)).toEqual({ state: "starting", sessions: [] });
  });

  it("ends a helper that never gets ready, and starts another", () => {
    const { helpers, listen, time } = setup();
    listen();
    time.advance(START_TIMEOUT_MS);
    expect(helpers[0]!.killed).toBe(true);
    expect(helpers).toHaveLength(2);
  });

  it("says unavailable where there is no helper", () => {
    const { listen } = setup({ unavailable: true });
    expect(listen().state()).toEqual({ state: "unavailable", sessions: [] });
  });

  it("passes a control to the helper and answers what it says", async () => {
    const { helpers, listen } = setup();
    const sub = listen();
    const helper = helpers[0]!;
    helper.say({ type: "sessions", sessions: [SESSION] });
    const answer = sub.control("Spotify.exe#0", "next");
    const sent = JSON.parse(helper.written[0]!);
    expect(sent).toEqual({ req: sent.req, cmd: "control", id: "Spotify.exe#0", action: "next" });
    helper.say({ type: "result", req: sent.req, ok: true });
    await expect(answer).resolves.toBe(true);
  });

  it("answers false for a session that isn't there, a closed subscription, a timeout and a crash", async () => {
    const { helpers, listen, time } = setup();
    const sub = listen();
    const helper = helpers[0]!;
    helper.say({ type: "sessions", sessions: [SESSION] });
    await expect(sub.control("Chrome#0", "next")).resolves.toBe(false);
    const late = sub.control("Spotify.exe#0", "next");
    time.advance(CONTROL_TIMEOUT_MS);
    await expect(late).resolves.toBe(false);
    const cut = sub.control("Spotify.exe#0", "previous");
    helper.crash();
    await expect(cut).resolves.toBe(false);
    sub.close();
    await expect(sub.control("Spotify.exe#0", "next")).resolves.toBe(false);
  });

  it("stops everything on dispose", () => {
    const { helpers, listen, connector } = setup();
    listen();
    connector.dispose();
    expect(helpers[0]!.killed).toBe(true);
    expect(helpers).toHaveLength(1);
  });
});
