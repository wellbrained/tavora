import { afterEach, describe, expect, it, vi } from "vitest";
import { TavoraError, type LeaderboardMine, type LeaderboardOutcomeResult } from "./index.js";
import { isOffline, openResults, retryDelay, rowsOf, RESULT_BATCH } from "./results.js";
import { createMemoryHost } from "./testing.js";

const win = (id: string, at = 1_000): LeaderboardOutcomeResult => ({ id, outcome: "won", at, day: "2026-10-30" });
const ready = (host: { leaderboards: { setStatus(status: { shown: boolean }): void } }) => host.leaderboards.setStatus({ shown: true });
const queued = (host: { appStorage: { get(key: string): unknown } }, board = "daily") => (host.appStorage.get(`leaderboard-queue:${board}`) as { id: string }[] | null) ?? [];
const sent = (host: { calls: { "leaderboards.submit"?: { board: string; results: { id: string }[] }[] } }) => host.calls["leaderboards.submit"] ?? [];

afterEach(() => vi.useRealTimers());

describe("record and send", () => {
  it("keeps a result in storage at once and sends it when the user is on the boards", async () => {
    const { sdk, host } = createMemoryHost();
    const queue = await openResults(sdk);

    await queue.record("daily", win("a"));
    expect(queued(host).map((result) => result.id)).toEqual(["a"]);
    expect(queue.pending).toBe(1);
    expect(queue.has("a")).toBe(true);

    await queue.flush();
    expect(queue.status).toBe("waiting");
    expect(sent(host)).toHaveLength(0);
    expect(queued(host)).toHaveLength(1);

    ready(host);
    await queue.flush();
    expect(sent(host)).toEqual([{ board: "daily", results: [win("a")] }]);
    expect(queued(host)).toEqual([]);
    expect(queue.pending).toBe(0);
    expect(queue.has("a")).toBe(false);
    expect(queue.status).toBe("idle");
    queue.dispose();
  });

  it("sends in batches of up to 50 per board", async () => {
    const { sdk, host } = createMemoryHost();
    const queue = await openResults(sdk);
    for (let i = 0; i < 120; i++) await queue.record("daily", win(`d${i}`, 1_000 + i));
    await queue.record("unlimited", win("u0"));
    expect(queue.pending).toBe(121);

    ready(host);
    await queue.flush();
    expect(sent(host).map((call) => [call.board, call.results.length])).toEqual([
      ["daily", RESULT_BATCH],
      ["daily", RESULT_BATCH],
      ["daily", 20],
      ["unlimited", 1],
    ]);
    expect(sent(host)[0]!.results[0]!.id).toBe("d0");
    expect(queue.pending).toBe(0);
    queue.dispose();
  });

  it("records an id once", async () => {
    const { sdk, host } = createMemoryHost();
    const queue = await openResults(sdk);
    await queue.record("daily", win("a"));
    await queue.record("daily", win("a"));
    expect(queued(host)).toHaveLength(1);
    queue.dispose();
  });

  it("only takes the boards it was given", async () => {
    const { sdk } = createMemoryHost();
    const queue = await openResults(sdk, { boards: ["daily"] });
    await expect(queue.record("other", win("a"))).rejects.toThrow(TypeError);
    queue.dispose();
  });

  it("sends results an earlier session left behind when it opens", async () => {
    const { sdk, host } = createMemoryHost();
    ready(host);
    host.appStorage.set("leaderboard-queue:daily", [win("old")] as never);
    const queue = await openResults(sdk);
    expect(queue.pending).toBe(1);
    await queue.flush();
    expect(sent(host)).toHaveLength(1);
    expect(queue.pending).toBe(0);
    queue.dispose();
  });

  it("uses the key option for its storage", async () => {
    const { sdk, host } = createMemoryHost();
    const queue = await openResults(sdk, { key: "lb" });
    await queue.record("daily", win("a"));
    expect(host.appStorage.get("lb:daily")).toEqual([win("a")]);
    queue.dispose();
  });
});

describe("refused results", () => {
  it("drops a result the board refused, like a taken one", async () => {
    const { sdk, host } = createMemoryHost();
    host.answer("leaderboards.submit", ({ results }) => ({ accepted: [results[0]!.id], rejected: [{ id: results[1]!.id, reason: "archive" }] }));
    const queue = await openResults(sdk);
    await queue.record("daily", win("a"));
    await queue.record("daily", win("b"));
    ready(host);
    await queue.flush();
    expect(queue.pending).toBe(0);
    expect(queued(host)).toEqual([]);
    queue.dispose();
  });

  it("keeps results while the user is signed out and sends them after they agree", async () => {
    vi.useFakeTimers();
    const { sdk, host } = createMemoryHost();
    host.leaderboards.setStatus({ signedIn: false });
    const queue = await openResults(sdk, { pollMs: 1_000 });
    await queue.record("daily", win("a"));
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.status).toBe("waiting");

    host.leaderboards.setStatus({ signedIn: true, shown: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent(host)).toHaveLength(1);
    expect(queue.pending).toBe(0);
    expect(queue.status).toBe("idle");
    queue.dispose();
  });

  it("keeps results when the host refuses the send as signed out", async () => {
    const { sdk, host } = createMemoryHost();
    ready(host);
    host.answer("leaderboards.submit", () => {
      throw new TavoraError({ code: "PERMISSION_DENIED", message: "signed out" });
    });
    const queue = await openResults(sdk);
    await queue.record("daily", win("a"));
    await queue.flush();
    expect(queue.status).toBe("waiting");
    expect(queue.pending).toBe(1);
    queue.dispose();
  });

  it("says denied when the connector is not allowed, and keeps the results", async () => {
    const { sdk, host } = createMemoryHost({ capabilities: [] });
    const queue = await openResults(sdk);
    await queue.record("daily", win("a"));
    await queue.flush();
    expect(queue.status).toBe("denied");
    expect(queued(host)).toHaveLength(1);
    queue.dispose();
  });

  it("sends a batch the host calls invalid one by one and drops only the bad result", async () => {
    const { sdk, host } = createMemoryHost();
    host.answer("leaderboards.submit", ({ results }) => {
      if (results.length > 1 || results[0]!.id === "bad") throw new TavoraError({ code: "INVALID_PARAMS", message: "bad result" });
      return { accepted: [results[0]!.id], rejected: [] };
    });
    const queue = await openResults(sdk);
    await queue.record("daily", win("a"));
    await queue.record("daily", win("bad"));
    await queue.record("daily", win("c"));
    ready(host);
    await queue.flush();
    expect(queue.pending).toBe(0);
    queue.dispose();
  });
});

describe("offline", () => {
  it("keeps results on a network error and retries with a growing wait", async () => {
    vi.useFakeTimers();
    const { sdk, host } = createMemoryHost();
    ready(host);
    let down = true;
    host.answer("leaderboards.submit", ({ results }) => {
      if (down) throw new TavoraError({ code: "NETWORK_ERROR", message: "offline" });
      return { accepted: results.map((result) => result.id), rejected: [] };
    });
    const queue = await openResults(sdk);
    const states: string[] = [];
    queue.onStatus((state) => states.push(state));
    await queue.record("daily", win("a"));
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.status).toBe("offline");
    expect(queue.pending).toBe(1);
    expect(queued(host)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(retryDelay(1) - 1);
    expect(sent(host)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent(host)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(retryDelay(2) - 1);
    expect(sent(host)).toHaveLength(2);

    down = false;
    await vi.advanceTimersByTimeAsync(1);
    expect(sent(host)).toHaveLength(3);
    expect(queue.pending).toBe(0);
    expect(queue.status).toBe("idle");
    expect(states).toContain("offline");
    expect(states.at(-1)).toBe("idle");
    queue.dispose();
  });

  it("tries again when the panel resumes", async () => {
    vi.useFakeTimers();
    const { sdk, host } = createMemoryHost();
    ready(host);
    host.leaderboards.setStatus({ online: false });
    const queue = await openResults(sdk);
    await queue.record("daily", win("a"));
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.status).toBe("offline");

    host.leaderboards.setStatus({ online: true });
    host.suspend();
    host.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.pending).toBe(0);
    expect(queue.status).toBe("idle");
    queue.dispose();
  });

  it("stops retrying after dispose", async () => {
    vi.useFakeTimers();
    const { sdk, host } = createMemoryHost();
    ready(host);
    host.leaderboards.setStatus({ online: false });
    const queue = await openResults(sdk);
    await queue.record("daily", win("a"));
    await vi.advanceTimersByTimeAsync(0);
    const calls = host.calls["leaderboards.status"]!.length;
    queue.dispose();
    await vi.advanceTimersByTimeAsync(retryDelay(10));
    host.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.calls["leaderboards.status"]).toHaveLength(calls);
    expect(queued(host)).toHaveLength(1);
  });

  it("backs off 1, 2, 4 ... at most 30 minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((failures) => retryDelay(failures) / 60_000)).toEqual([1, 2, 4, 8, 16, 30, 30, 30]);
    expect(retryDelay(0)).toBe(60_000);
  });
});

describe("standing", () => {
  it("tells where the user stands after results were taken", async () => {
    const { sdk, host } = createMemoryHost();
    ready(host);
    const mine: LeaderboardMine = { boards: [{ id: "daily", name: "Daily", periods: { day: null, week: null, month: null, year: null, all: { rank: 2, of: 10, current: 1, best: 3 } } }] };
    host.answer("leaderboards.mine", () => mine);
    const queue = await openResults(sdk);
    const standings: LeaderboardMine[] = [];
    queue.onStanding((standing) => standings.push(standing));
    await queue.record("daily", win("a"));
    await queue.flush();
    expect(standings).toEqual([mine]);

    await queue.flush();
    expect(standings).toHaveLength(1);
    queue.dispose();
  });
});

describe("two panels", () => {
  it("lose nothing when both record at the same time", async () => {
    const first = createMemoryHost();
    const second = createMemoryHost({ share: first.host });
    const a = await openResults(first.sdk);
    const b = await openResults(second.sdk);
    await Promise.all([...Array.from({ length: 10 }, (_, i) => a.record("daily", win(`a${i}`))), ...Array.from({ length: 10 }, (_, i) => b.record("daily", win(`b${i}`)))]);
    expect(queued(first.host).map((result) => result.id).sort()).toEqual([...Array.from({ length: 10 }, (_, i) => `a${i}`), ...Array.from({ length: 10 }, (_, i) => `b${i}`)].sort());
    a.dispose();
    b.dispose();
  });

  it("keeps a result another panel recorded while this one was sending", async () => {
    const first = createMemoryHost();
    const second = createMemoryHost({ share: first.host });
    ready(first.host);
    const a = await openResults(first.sdk);
    const b = await openResults(second.sdk);
    first.host.answer("leaderboards.submit", async ({ results }) => {
      await b.record("daily", win("late"));
      return { accepted: results.map((result) => result.id), rejected: [] };
    });
    await a.record("daily", win("early"));
    await a.flush();
    await b.flush();
    expect(sent(first.host).flatMap((call) => call.results.map((result) => result.id))).toContain("late");
    a.dispose();
    b.dispose();
  });
});

describe("older hosts", () => {
  it("sends without `online` in the status and without `mine`", async () => {
    const { sdk, host } = createMemoryHost({ version: "0.21.92" });
    ready(host);
    host.answer("leaderboards.status", () => ({ signedIn: true, available: true, shown: true, name: "Mara" }) as never);
    const queue = await openResults(sdk);
    const standings: unknown[] = [];
    queue.onStanding((standing) => standings.push(standing));
    await queue.record("daily", win("a"));
    await queue.flush();
    expect(queue.pending).toBe(0);
    expect(queue.status).toBe("idle");
    expect(standings).toEqual([]);
    queue.dispose();
  });

  it("reads `top` answers in both shapes and a missing `online` as online", () => {
    const row = { rank: 1, of: 1, name: "Mara", self: true };
    expect(rowsOf([row])).toEqual([row]);
    expect(rowsOf({ rows: [row] })).toEqual([row]);
    expect(rowsOf(null)).toEqual([]);
    expect(isOffline({})).toBe(false);
    expect(isOffline({ online: false })).toBe(true);
  });

  it("says unsupported on a Tavora without leaderboards", async () => {
    const { sdk, host } = createMemoryHost({ version: "0.21.92" });
    host.answer("leaderboards.status", () => {
      throw new TavoraError({ code: "UNKNOWN_METHOD", message: "no leaderboards" });
    });
    const queue = await openResults(sdk);
    await queue.record("daily", win("a"));
    await queue.flush();
    expect(queue.status).toBe("unsupported");
    expect(queued(host)).toHaveLength(1);
    queue.dispose();
  });
});
