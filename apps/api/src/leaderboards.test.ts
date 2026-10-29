import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LeaderboardBoard } from "@tavora/module-schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import {
  boardName,
  checkResult,
  dayWindow,
  LeaderboardStore,
  leaderboardRoutes,
  leaderboardsAdminRoutes,
  liveStreak,
  minGamesOf,
  periodKey,
  periodRange,
  shapeOf,
  streakOf,
  type Played,
} from "./leaderboards.ts";
import { createTestInbox } from "./mail.ts";
import { createRateLimiter } from "./rate-limit.ts";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const HOUR = 3_600_000;
const DAY_MS = 24 * HOUR;
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });

const BOARDS: LeaderboardBoard[] = [
  { id: "unlimited", name: "Winning streak", kind: "streak" },
  { id: "daily", name: "Daily streak", kind: "streak", daily: true },
  { id: "fastest", name: "Fastest solve", kind: "score", order: "low", unit: "s" },
  { id: "points", name: "Points", kind: "score" },
  { id: "solved", name: "Puzzles solved", kind: "total" },
  { id: "average", name: "Average time", kind: "average", order: "low", minGames: 3, unit: "s" },
  { id: "winrate", name: "Win rate", kind: "rate", minGames: 3 },
];

function setup() {
  const accounts = new AccountStore(":memory:");
  const leaderboards = new LeaderboardStore(":memory:");
  const clock = { now: NOW };
  const app = new Hono();
  app.route(
    "/v1/leaderboards",
    leaderboardRoutes({
      leaderboards,
      accounts,
      boards: (moduleId) => (moduleId === "wellbrained.word-guess" ? BOARDS : null),
      clientKey: () => "test",
      writeRateLimiter: roomy(),
      readRateLimiter: roomy(),
      now: () => clock.now,
    }),
  );
  const admin = leaderboardsAdminRoutes({ leaderboards, accounts, now: () => clock.now });
  const user = (email: string, name: string | null = "Mara") => {
    const account = accounts.createAccount({ email }, clock.now);
    if (name !== null) accounts.setProfile(account.id, { name, initials: "MA", picture: null, updatedAt: clock.now });
    return { id: account.id, token: accounts.createSession(account.id, "windows", clock.now).token };
  };
  const call = async (method: string, pathname: string, token?: string, body?: unknown) => {
    const response = await app.request(`http://tavora.test/v1/leaderboards${pathname}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const adminCall = async (method: string, pathname: string, body?: unknown) => {
    const response = await admin.request(`http://admin.test${pathname}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return (await response.json()) as Record<string, unknown>;
  };
  const allow = () => adminCall("POST", "/modules", { id: "wellbrained.word-guess", allowed: true });
  const show = (token: string, moduleId = "wellbrained.word-guess") => call("PUT", `/${moduleId}/shown`, token);
  const submit = (token: string, board: string, results: unknown[], moduleId = "wellbrained.word-guess", declaration?: unknown) =>
    call("POST", `/${moduleId}/boards/${board}`, token, { results, ...(declaration ? { board: declaration } : {}) });
  const top = async (board: string, token?: string, query = "", moduleId = "wellbrained.word-guess") => (await call("GET", `/${moduleId}/boards/${board}${query}`, token)).body.rows;
  const mine = async (token?: string, query = "", moduleId = "wellbrained.word-guess") => call("GET", `/${moduleId}/mine${query}`, token);
  return { accounts, leaderboards, clock, user, call, adminCall, allow, show, submit, top, mine };
}

const dayAt = (at: number) => new Date(at).toISOString().slice(0, 10);
/** At noon UTC of a day, which every day window holds. */
const noon = (day: string) => Date.parse(`${day}T12:00:00Z`);
const won = (at: number, day = dayAt(at)) => ({ id: randomUUID(), outcome: "won", at, day });
const lost = (at: number, day = dayAt(at)) => ({ id: randomUUID(), outcome: "lost", at, day });
const worth = (value: number, at: number = NOW, day = dayAt(at)) => ({ id: randomUUID(), value, at, day });

describe("checking one result", () => {
  it("takes a well-formed result and keeps the id lowercase", () => {
    const id = randomUUID().toUpperCase();
    expect(checkResult({ id, outcome: "won", at: NOW, day: "2026-10-28" }, "streak", NOW)).toEqual({ ok: { id: id.toLowerCase(), at: NOW, outcome: "won", value: null, day: "2026-10-28" } });
    expect(checkResult({ id, outcome: "lost", at: NOW, day: "2026-10-28" }, "rate", NOW)).toHaveProperty("ok.outcome", "lost");
    expect(checkResult({ id, value: 61_500, at: NOW, day: "2026-10-28" }, "score-low", NOW)).toEqual({ ok: { id: id.toLowerCase(), at: NOW, outcome: null, value: 61_500, day: "2026-10-28" } });
    expect(checkResult({ id, value: 0, at: NOW, day: "2026-10-28" }, "total", NOW)).toHaveProperty("ok.value", 0);
    expect(checkResult({ id, value: -2.5, at: NOW, day: "2026-10-28" }, "average-high", NOW)).toHaveProperty("ok.value", -2.5);
  });

  it("says why it refuses one, by the id it was sent with", () => {
    const id = randomUUID();
    const day = "2026-10-28";
    expect(checkResult({ id: "run-1", outcome: "won", at: NOW, day }, "streak", NOW)).toEqual({ id: "run-1", reason: "invalid" });
    expect(checkResult({ id, outcome: "draw", at: NOW, day }, "streak", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, value: 3, at: NOW, day }, "rate", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, outcome: "won", at: NOW, day }, "total", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, value: Number.NaN, at: NOW, day }, "score-high", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, value: 1e13, at: NOW, day }, "score-high", NOW)).toEqual({ id, reason: "invalid" });
    // A total only adds up.
    expect(checkResult({ id, value: -1, at: NOW, day }, "total", NOW)).toEqual({ id, reason: "invalid" });
    // The day is needed on every kind, and must be a real one.
    expect(checkResult({ id, outcome: "won", at: NOW }, "streak", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, value: 1, at: NOW }, "total", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, outcome: "won", at: NOW }, "streak-daily", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, outcome: "won", at: NOW, day: "2026-02-30" }, "streak-daily", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, outcome: "won", at: NOW + HOUR, day }, "streak", NOW)).toEqual({ id, reason: "time" });
    expect(checkResult({ id, outcome: "won", at: NOW - 400 * 24 * HOUR, day: "2025-09-23" }, "streak", NOW)).toEqual({ id, reason: "time" });
    // Without a string id there is nothing to name in the answer.
    expect(checkResult({ outcome: "won", at: NOW, day }, "streak", NOW)).toBeNull();
    expect(checkResult("won", "streak", NOW)).toBeNull();
  });

  it("counts a result only when it ended within its day somewhere on earth, on every kind", () => {
    const { from, to } = dayWindow("2026-10-28");
    expect(new Date(from).toISOString()).toBe("2026-10-27T10:00:00.000Z");
    expect(new Date(to).toISOString()).toBe("2026-10-29T12:00:00.000Z");
    const id = randomUUID();
    expect(checkResult({ id, outcome: "won", at: from, day: "2026-10-28" }, "streak-daily", NOW)).toHaveProperty("ok");
    expect(checkResult({ id, outcome: "won", at: from - 1, day: "2026-10-28" }, "streak-daily", NOW + DAY_MS)).toEqual({ id, reason: "archive" });
    // An archive replay: an old puzzle, played today.
    expect(checkResult({ id, outcome: "won", at: NOW, day: "2026-10-20" }, "streak-daily", NOW)).toEqual({ id, reason: "archive" });
    expect(checkResult({ id, outcome: "won", at: NOW, day: "2026-10-20" }, "streak", NOW)).toEqual({ id, reason: "archive" });
    expect(checkResult({ id, value: 5, at: NOW, day: "2026-10-20" }, "score-high", NOW)).toEqual({ id, reason: "archive" });
    expect(checkResult({ id, value: 5, at: NOW, day: "2026-10-20" }, "total", NOW)).toEqual({ id, reason: "archive" });
  });
});

describe("shapes and minimum games", () => {
  it("names how each kind of board is worked out", () => {
    expect(BOARDS.map(shapeOf)).toEqual(["streak", "streak-daily", "score-low", "score-high", "total", "average-low", "rate"]);
    expect(shapeOf({ id: "a", name: "A", kind: "average" })).toBe("average-high");
  });

  it("asks ten games of an average or a rate board unless it says otherwise", () => {
    expect(minGamesOf({ id: "a", name: "A", kind: "average" })).toBe(10);
    expect(minGamesOf({ id: "a", name: "A", kind: "rate", minGames: 25 })).toBe(25);
    expect(minGamesOf({ id: "a", name: "A", kind: "total" })).toBe(1);
  });
});

describe("periods", () => {
  it("puts a day in its period: the week runs Monday to Sunday", () => {
    // 2026-10-25 is a Sunday, 2026-10-26 the Monday after.
    expect(periodKey("day", "2026-10-25")).toBe("2026-10-25");
    expect(periodKey("week", "2026-10-25")).toBe("2026-10-19");
    expect(periodKey("week", "2026-10-26")).toBe("2026-10-26");
    expect(periodKey("week", "2026-10-28")).toBe("2026-10-26");
    expect(periodKey("month", "2026-10-31")).toBe("2026-10");
    expect(periodKey("month", "2026-11-01")).toBe("2026-11");
    expect(periodKey("year", "2026-12-31")).toBe("2026");
    expect(periodKey("year", "2027-01-01")).toBe("2027");
    expect(periodKey("all", "2026-10-28")).toBe("");
    // A week can cross a month and a year.
    expect(periodKey("week", "2027-01-01")).toBe("2026-12-28");
  });

  it("says which days a period covers", () => {
    expect(periodRange("day", "2026-10-25")).toEqual({ from: "2026-10-25", to: "2026-10-25" });
    expect(periodRange("week", "2026-12-28")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(periodRange("month", "2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("month", "2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("month", "2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(periodRange("year", "2026")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodRange("all", "")).toBeNull();
  });
});

describe("working out streaks", () => {
  const played = (outcome: "won" | "lost", at: number, day: string | null = null): Played => ({ id: randomUUID(), outcome, at, day });

  it("goes by the order games ended, whatever order they arrived in", () => {
    const results = [played("won", 3), played("won", 1), played("lost", 4), played("won", 2), played("won", 5)];
    expect(streakOf(results, false)).toEqual({ best: 3, reachedAt: 3, current: 1, lastDay: null });
  });

  it("ends a daily streak on a lost day and on a missed one", () => {
    const results = [
      played("won", 1, "2026-10-20"),
      played("won", 2, "2026-10-21"),
      played("won", 3, "2026-10-22"),
      // 23rd missed.
      played("won", 5, "2026-10-24"),
      played("won", 6, "2026-10-25"),
      played("lost", 7, "2026-10-26"),
      played("won", 8, "2026-10-27"),
    ];
    expect(streakOf(results, true)).toEqual({ best: 3, reachedAt: 3, current: 1, lastDay: "2026-10-27" });
  });

  it("shows a daily streak as running while its last day is today or yesterday", () => {
    expect(liveStreak(4, "2026-10-28", "2026-10-28")).toBe(4);
    expect(liveStreak(4, "2026-10-27", "2026-10-28")).toBe(4);
    expect(liveStreak(4, "2026-10-26", "2026-10-28")).toBe(0);
    expect(liveStreak(4, null, "2026-10-28")).toBe(0);
  });
});

describe("names on the boards", () => {
  it("shows the profile name unless it is missing, filtered or hidden", () => {
    expect(boardName("  Mara ", false)).toBe("Mara");
    expect(boardName("", false)).toBeNull();
    expect(boardName(null, false)).toBeNull();
    expect(boardName("Mara", true)).toBeNull();
    expect(boardName("f4ggot", false)).toBeNull();
    expect(boardName("mara.gg", false)).toBeNull();
  });
});

describe("the leaderboard routes", () => {
  it("runs a catalog module's boards only once the maintainer allows it", async () => {
    const { user, call, show, allow, adminCall, top } = setup();
    const mara = user("mara@example.com");
    expect((await call("GET", "/wellbrained.word-guess", mara.token)).body).toEqual({ available: false, shown: false, name: "Mara", label: null });
    expect((await show(mara.token)).body).toMatchObject({ reason: "not-allowed" });
    expect(await top("unlimited")).toEqual([]);

    expect(await allow()).toEqual({ changed: true });
    expect(await adminCall("GET", "/modules")).toEqual({ modules: [{ id: "wellbrained.word-guess", allowedAt: "2026-10-28T12:00:00.000Z" }] });
    const status = (await call("GET", "/wellbrained.word-guess", mara.token)).body;
    expect(status).toEqual({ available: true, shown: false, name: "Mara", label: expect.stringMatching(/^[A-Z][2-9]$/) });
    expect((await call("GET", "/wellbrained.word-guess")).body).toEqual({ available: true, shown: false, name: null, label: null });
  });

  it("takes results only from a user who agreed to show them", async () => {
    const { user, show, allow, submit, call } = setup();
    await allow();
    const mara = user("mara@example.com");
    expect((await submit(mara.token, "unlimited", [won(NOW)])).body).toMatchObject({ reason: "not-shown" });
    expect((await call("POST", "/wellbrained.word-guess/boards/unlimited", undefined, { results: [won(NOW)] })).status).toBe(401);
    expect((await show(mara.token)).body).toMatchObject({ available: true, shown: true, name: "Mara" });
    expect((await submit(mara.token, "unlimited", [won(NOW)])).status).toBe(200);
  });

  it("takes or refuses each result on its own, and a result sent again changes nothing", async () => {
    const { user, show, allow, submit, top } = setup();
    await allow();
    const mara = user("mara@example.com");
    await show(mara.token);
    const first = won(NOW - 3000);
    const bad = { id: randomUUID(), outcome: "maybe", at: NOW, day: "2026-10-28" };
    const future = won(NOW + HOUR);
    const answer = await submit(mara.token, "unlimited", [first, bad, won(NOW - 2000), future, { outcome: "won" }, won(NOW - 1000)]);
    expect(answer.body).toEqual({
      accepted: [first.id, expect.any(String), expect.any(String)],
      rejected: [
        { id: bad.id, reason: "invalid" },
        { id: future.id, reason: "time" },
      ],
    });
    expect(await top("unlimited", mara.token)).toEqual([{ rank: 1, of: 1, name: "Mara", self: true, current: 3, best: 3 }]);
    // Again, with a loss on top: the old ones count once.
    expect((await submit(mara.token, "unlimited", [first, lost(NOW)])).body).toMatchObject({ accepted: [first.id, expect.any(String)], rejected: [] });
    expect(await top("unlimited", mara.token)).toEqual([{ rank: 1, of: 1, name: "Mara", self: true, current: 0, best: 3 }]);
  });

  it("keeps one daily result a day and never counts a replay from the archive", async () => {
    const { user, show, allow, submit, top, clock } = setup();
    await allow();
    const mara = user("mara@example.com");
    await show(mara.token);
    const today = won(NOW, "2026-10-28");
    const again = won(NOW + 60_000, "2026-10-28");
    const replay = won(NOW, "2026-10-01");
    const answer = await submit(mara.token, "daily", [won(NOW - DAY_MS, "2026-10-27"), today, again, replay]);
    expect(answer.body).toMatchObject({
      rejected: [
        { id: again.id, reason: "day-taken" },
        { id: replay.id, reason: "archive" },
      ],
    });
    expect(await top("daily", mara.token, "?day=2026-10-28")).toEqual([{ rank: 1, of: 1, name: "Mara", self: true, current: 2, best: 2 }]);
    // Tomorrow (within a day of the server's today) is read as it is, and the streak still runs.
    expect(await top("daily", mara.token, "?day=2026-10-29")).toEqual([{ rank: 1, of: 1, name: "Mara", self: true, current: 2, best: 2 }]);
    // Two days later without playing, the streak has ended; its best stays.
    clock.now += 2 * DAY_MS;
    expect(await top("daily", mara.token)).toEqual([{ rank: 1, of: 1, name: "Mara", self: true, current: 0, best: 2 }]);
  });

  it("takes one result a day on a board that isn't daily, and refuses an archive replay there too", async () => {
    const { user, show, allow, submit, top } = setup();
    await allow();
    const mara = user("mara@example.com");
    await show(mara.token);
    const replay = worth(5, NOW, "2026-10-01");
    const answer = await submit(mara.token, "solved", [worth(1, NOW - 2000), worth(1, NOW - 1000), replay]);
    expect(answer.body).toMatchObject({ accepted: [expect.any(String), expect.any(String)], rejected: [{ id: replay.id, reason: "archive" }] });
    expect(await top("solved")).toEqual([{ rank: 1, of: 1, name: "Mara", self: false, value: 2, games: 2 }]);
  });

  it("ranks score boards by each user's best, the lowest first where low wins, and shares ranks on a tie", async () => {
    const { user, show, allow, submit, top } = setup();
    await allow();
    const [mara, jon, ida] = [user("mara@example.com", "Mara"), user("jon@example.com", "Jon"), user("ida@example.com", "Ida")];
    for (const person of [mara, jon, ida]) await show(person.token);
    await submit(mara.token, "fastest", [worth(90_000, NOW - 5000), worth(70_000, NOW - 4000)]);
    await submit(jon.token, "fastest", [worth(70_000, NOW - 3000)]);
    await submit(ida.token, "fastest", [worth(80_000, NOW - 2000)]);
    expect(await top("fastest", jon.token)).toEqual([
      { rank: 1, of: 3, name: "Mara", self: false, value: 70_000 },
      { rank: 1, of: 3, name: "Jon", self: true, value: 70_000 },
      { rank: 3, of: 3, name: "Ida", self: false, value: 80_000 },
    ]);
    await submit(ida.token, "points", [worth(12), worth(40)]);
    expect(await top("points")).toEqual([{ rank: 1, of: 1, name: "Ida", self: false, value: 40 }]);
  });

  it("ranks total boards by each user's sum, and the one who got there first wins a tie in order", async () => {
    const { user, show, allow, submit, top } = setup();
    await allow();
    const [mara, jon, ida, zed] = [user("mara@example.com", "Mara"), user("jon@example.com", "Jon"), user("ida@example.com", "Ida"), user("zed@example.com", "Zed")];
    for (const person of [mara, jon, ida, zed]) await show(person.token);
    await submit(mara.token, "solved", [worth(2, NOW - 5000), worth(3, NOW - 1000)]);
    await submit(jon.token, "solved", [worth(5, NOW - 3000)]);
    await submit(ida.token, "solved", [worth(9, NOW - 2000)]);
    // A zero counts as a game but adds nothing; Zed has the lowest sum.
    await submit(zed.token, "solved", [worth(0, NOW - 100)]);
    expect(await top("solved")).toEqual([
      { rank: 1, of: 4, name: "Ida", self: false, value: 9, games: 1 },
      // Jon reached 5 at -3000, Mara at -1000.
      { rank: 2, of: 4, name: "Jon", self: false, value: 5, games: 1 },
      { rank: 2, of: 4, name: "Mara", self: false, value: 5, games: 2 },
      { rank: 4, of: 4, name: "Zed", self: false, value: 0, games: 1 },
    ]);
  });

  it("ranks average boards by the mean, more games first on a tie, and leaves out users under the minimum", async () => {
    const { user, show, allow, submit, top } = setup();
    await allow();
    const [a, b, c, d, e] = ["A", "B", "C", "D", "E"].map((name) => user(`${name}@example.com`, name));
    for (const person of [a, b, c, d, e]) await show(person!.token);
    // Low wins, three games needed.
    await submit(a!.token, "average", [worth(10, NOW - 3000), worth(10, NOW - 2000), worth(10, NOW - 1000)]);
    await submit(b!.token, "average", [worth(1, NOW - 2000), worth(1, NOW - 1000)]);
    await submit(c!.token, "average", [worth(5, NOW - 3500), worth(10, NOW - 2500), worth(15, NOW - 1500)]);
    await submit(d!.token, "average", [worth(8, NOW - 4000), worth(10, NOW - 3000), worth(10, NOW - 2000), worth(12, NOW - 1000)]);
    await submit(e!.token, "average", [worth(3, NOW - 3000), worth(3, NOW - 2000), worth(3, NOW - 1000)]);
    expect(await top("average", a!.token)).toEqual([
      { rank: 1, of: 4, name: "E", self: false, value: 3, games: 3 },
      // D, A and C all average 10; D played the most, C reached it before A.
      { rank: 2, of: 4, name: "D", self: false, value: 10, games: 4 },
      { rank: 3, of: 4, name: "C", self: false, value: 10, games: 3 },
      { rank: 3, of: 4, name: "A", self: true, value: 10, games: 3 },
    ]);
    // B, with two games, is on no board yet, and not in `of`.
    expect(await top("average", b!.token, "?limit=1")).toEqual([{ rank: 1, of: 4, name: "E", self: false, value: 3, games: 3 }]);
    // A development copy can ask for a different minimum.
    expect(await top("average", a!.token, "?kind=average&order=low&minGames=nope", "local.word-guess")).toEqual([]);
  });

  it("ranks rate boards by the share won, more games first on a tie, and from the minimum only", async () => {
    const { user, show, allow, submit, top } = setup();
    await allow();
    const [a, b, c, d] = ["A", "B", "C", "D"].map((name) => user(`${name}@example.com`, name));
    for (const person of [a, b, c, d]) await show(person!.token);
    await submit(a!.token, "winrate", [won(NOW - 3000), won(NOW - 2000), lost(NOW - 1000)]);
    await submit(b!.token, "winrate", [won(NOW - 4000), won(NOW - 3000), won(NOW - 2000), lost(NOW - 1000)]);
    await submit(c!.token, "winrate", [won(NOW - 2000), won(NOW - 1000)]);
    await submit(d!.token, "winrate", [lost(NOW - 3000), lost(NOW - 2000), won(NOW - 1000), won(NOW - 500), lost(NOW - 400), lost(NOW - 300)]);
    expect(await top("winrate")).toEqual([
      { rank: 1, of: 3, name: "B", self: false, value: 75, games: 4, wins: 3 },
      { rank: 2, of: 3, name: "A", self: false, value: 66.7, games: 3, wins: 2 },
      { rank: 3, of: 3, name: "D", self: false, value: 33.3, games: 6, wins: 2 },
    ]);
  });

  it("adds the reader's own line last when they are further down", async () => {
    const { user, show, allow, submit, top } = setup();
    await allow();
    const people = await Promise.all(["a", "b", "c"].map(async (name) => user(`${name}@example.com`, name.toUpperCase())));
    for (const [index, person] of people.entries()) {
      await show(person.token);
      await submit(person.token, "unlimited", Array.from({ length: 3 - index }, (_, i) => won(NOW - 10_000 + i)));
    }
    expect(await top("unlimited", people[2]!.token, "?limit=1")).toEqual([
      { rank: 1, of: 3, name: "A", self: false, current: 3, best: 3 },
      { rank: 3, of: 3, name: "C", self: true, current: 1, best: 1 },
    ]);
  });

  it("reads every period from a result's day, and a past one with `day`", async () => {
    const { user, show, allow, submit, top } = setup();
    await allow();
    const mara = user("mara@example.com");
    await show(mara.token);
    // A Sunday, the Monday after, the end of the month before, and the year before.
    const sunday = worth(1, noon("2026-10-25"), "2026-10-25");
    const monday = worth(2, noon("2026-10-26"), "2026-10-26");
    const september = worth(4, noon("2026-09-30"), "2026-09-30");
    const lastYear = worth(8, noon("2025-12-31"), "2025-12-31");
    expect((await submit(mara.token, "solved", [sunday, monday, september, lastYear])).body).toMatchObject({ rejected: [] });
    const value = async (query: string) => ((await top("solved", mara.token, query)) as { value: number; games: number; of: number }[])[0];
    expect(await value("")).toMatchObject({ value: 15, games: 4 });
    expect(await value("?period=all")).toMatchObject({ value: 15 });
    expect(await value("?period=day&day=2026-10-26")).toMatchObject({ value: 2, games: 1 });
    expect(await value("?period=day")).toBeUndefined();
    // Sunday and Monday are in different weeks.
    expect(await value("?period=week&day=2026-10-25")).toMatchObject({ value: 1 });
    expect(await value("?period=week&day=2026-10-26")).toMatchObject({ value: 2 });
    expect(await value("?period=week&day=2026-10-28")).toMatchObject({ value: 2 });
    expect(await value("?period=month&day=2026-10-28")).toMatchObject({ value: 3, games: 2 });
    expect(await value("?period=month&day=2026-09-01")).toMatchObject({ value: 4 });
    expect(await value("?period=year&day=2026-01-01")).toMatchObject({ value: 7, games: 3 });
    expect(await value("?period=year&day=2025-06-01")).toMatchObject({ value: 8 });
    expect(await value("?period=year&day=2024-06-01")).toBeUndefined();
  });

  it("works a streak out from one period's results alone, and has no day period", async () => {
    const { user, show, allow, submit, top } = setup();
    await allow();
    const mara = user("mara@example.com");
    await show(mara.token);
    const days = ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"];
    await submit(mara.token, "unlimited", days.map((day) => won(noon(day), day)));
    const line = async (query: string) => top("unlimited", mara.token, query);
    expect(await line("")).toEqual([{ rank: 1, of: 1, name: "Mara", self: true, current: 6, best: 6 }]);
    // Monday 19th to Sunday 25th: four days; the next week: two.
    expect(await line("?period=week&day=2026-10-25")).toEqual([{ rank: 1, of: 1, name: "Mara", self: true, current: 4, best: 4 }]);
    expect(await line("?period=week&day=2026-10-27")).toEqual([{ rank: 1, of: 1, name: "Mara", self: true, current: 2, best: 2 }]);
    expect(await line("?period=day")).toEqual([]);
  });

  it("answers 400 for a period or a day it doesn't know", async () => {
    const { user, show, allow, call } = setup();
    await allow();
    const mara = user("mara@example.com");
    await show(mara.token);
    const get = (query: string) => call("GET", `/wellbrained.word-guess/boards/solved${query}`, mara.token);
    expect((await get("?period=decade")).status).toBe(400);
    expect((await get("?period=decade")).body).toMatchObject({ reason: "bad-request" });
    expect((await get("?day=2026-02-30")).status).toBe(400);
    expect((await get("?day=2026-10-30")).status).toBe(400);
    expect((await get("?day=2026-10-29")).status).toBe(200);
    expect((await call("GET", "/wellbrained.word-guess/mine?day=soon", mara.token)).status).toBe(400);
  });

  it("shows a pseudonym for a filtered or hidden name, and leaves suspended and banned accounts out", async () => {
    const { accounts, user, show, allow, submit, top, adminCall, call } = setup();
    await allow();
    const rude = user("rude@example.com", "kys now");
    const mara = user("mara@example.com", "Mara");
    const gone = user("gone@example.com", "Gone");
    const dev = user("dev@example.com", "Dev");
    for (const person of [rude, mara, gone, dev]) {
      await show(person.token);
      await submit(person.token, "unlimited", [won(NOW)]);
    }
    const rows = (await top("unlimited")) as { name: string | null; label?: string }[];
    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining([null, "Mara", "Gone", "Dev"]));
    expect(rows.find((row) => row.name === null)!.label).toMatch(/^[A-Z][2-9]$/);
    // The account and its name stay as they were.
    expect(accounts.profileName(rude.id)).toBe("kys now");

    expect(await adminCall("POST", "/hidden-names", { accountId: mara.id, hidden: true })).toEqual({ changed: true });
    expect(await adminCall("GET", "/hidden-names")).toEqual({ names: [{ accountId: mara.id, name: "Mara", hiddenAt: "2026-10-28T12:00:00.000Z" }] });
    expect((await call("GET", "/wellbrained.word-guess", mara.token)).body).toMatchObject({ name: null, label: expect.any(String) });

    accounts.suspend(gone.id, "spam", null, NOW);
    accounts.ban(dev.id, "malware", null, [], NOW);
    const after = (await top("unlimited")) as { name: string | null; rank: number; of: number }[];
    expect(after.map((row) => [row.rank, row.of, row.name])).toEqual([
      [1, 2, null],
      [1, 2, null],
    ]);
  });

  it("deletes a user's results for the module when they switch it off", async () => {
    const { user, show, allow, submit, top, call, mine } = setup();
    await allow();
    const mara = user("mara@example.com");
    await show(mara.token);
    await submit(mara.token, "unlimited", [won(NOW)]);
    await submit(mara.token, "fastest", [worth(1)]);
    expect((await call("DELETE", "/wellbrained.word-guess/shown", mara.token)).body).toMatchObject({ shown: false });
    expect(await top("unlimited")).toEqual([]);
    expect(await top("fastest")).toEqual([]);
    // Shown again: nothing comes back, the board starts fresh.
    await show(mara.token);
    expect(await top("unlimited")).toEqual([]);
    expect(((await mine(mara.token)).body.boards as { periods: Record<string, unknown> }[])[0]!.periods.all).toBeNull();
  });

  it("refuses a board the catalog's manifest doesn't declare", async () => {
    const { user, show, allow, submit, top } = setup();
    await allow();
    const mara = user("mara@example.com");
    await show(mara.token);
    expect((await submit(mara.token, "weekly", [won(NOW)])).body).toMatchObject({ reason: "unknown-board" });
    expect((await submit(mara.token, "Weekly", [won(NOW)])).body).toMatchObject({ reason: "unknown-board" });
    expect(await top("weekly")).toBeUndefined();
  });

  it("gives a development copy test boards that only its developer sees, without allowing", async () => {
    const { user, show, submit, top, call } = setup();
    const dev = user("dev@example.com", "Dev");
    const other = user("other@example.com", "Other");
    expect((await call("GET", "/local.word-guess", dev.token)).body).toMatchObject({ available: true });
    for (const person of [dev, other]) {
      await show(person.token, "local.word-guess");
      await submit(person.token, "daily", [won(NOW, "2026-10-28")], "local.word-guess", { kind: "streak", daily: true });
    }
    expect(await top("daily", dev.token, "?kind=streak&daily=1", "local.word-guess")).toEqual([{ rank: 1, of: 1, name: "Dev", self: true, current: 1, best: 1 }]);
    expect(await top("daily", undefined, "?kind=streak&daily=1", "local.word-guess")).toEqual([]);
  });

  it("takes every kind from a development copy's declaration, and an unknown kind is an unknown board", async () => {
    const { user, show, submit, top } = setup();
    const dev = user("dev@example.com", "Dev");
    await show(dev.token, "local.word-guess");
    const local = (board: string, results: unknown[], declaration: unknown) => submit(dev.token, board, results, "local.word-guess", declaration);
    await local("total", [worth(2), worth(3)], { kind: "total" });
    await local("avg", [worth(4), worth(6), worth(8)], { kind: "average", order: "low", minGames: "3" });
    await local("rate", [won(NOW), lost(NOW)], { kind: "rate", minGames: 2 });
    expect((await local("odd", [worth(1)], { kind: "odd" })).body).toMatchObject({ reason: "unknown-board" });
    expect(await top("total", dev.token, "?kind=total", "local.word-guess")).toEqual([{ rank: 1, of: 1, name: "Dev", self: true, value: 5, games: 2 }]);
    expect(await top("avg", dev.token, "?kind=average&order=low&minGames=3", "local.word-guess")).toEqual([{ rank: 1, of: 1, name: "Dev", self: true, value: 6, games: 3 }]);
    // Asked for with ten games, the same line isn't on the board yet.
    expect(await top("avg", dev.token, "?kind=average&order=low", "local.word-guess")).toEqual([]);
    expect(await top("rate", dev.token, "?kind=rate&minGames=2&period=month", "local.word-guess")).toEqual([{ rank: 1, of: 1, name: "Dev", self: true, value: 50, games: 2, wins: 1 }]);
  });

  it("keeps each account to 10 development copies' test boards", async () => {
    const { user, show, call } = setup();
    const dev = user("dev@example.com", "Dev");
    for (let i = 0; i < 10; i++) expect((await show(dev.token, `local.copy${i}`)).status).toBe(200);
    expect((await show(dev.token, "local.copy10")).body).toMatchObject({ reason: "not-allowed" });
    expect((await call("GET", "/local.copy10", dev.token)).body).toMatchObject({ available: false });
    // The ones it has stay.
    expect((await call("GET", "/local.copy3", dev.token)).body).toMatchObject({ available: true });
  });

  it("takes a result it has already even when it comes again too late to count", async () => {
    const { user, show, allow, submit, clock } = setup();
    await allow();
    const mara = user("mara@example.com");
    await show(mara.token);
    const today = won(NOW, "2026-10-28");
    await submit(mara.token, "daily", [today]);
    clock.now += 5 * DAY_MS;
    expect((await submit(mara.token, "daily", [today])).body).toEqual({ accepted: [today.id], rejected: [] });
  });

  it("holds each account and module to its results limit and its request limit", async () => {
    const { leaderboards, accounts, clock } = setup();
    const limited = new Hono();
    limited.route(
      "/v1/leaderboards",
      leaderboardRoutes({ leaderboards, accounts, boards: () => BOARDS, clientKey: () => "test", writeRateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }), readRateLimiter: roomy(), now: () => clock.now }),
    );
    leaderboards.setAllowed("wellbrained.word-guess", true, NOW);
    const account = accounts.createAccount({ email: "mara@example.com" }, NOW);
    const token = accounts.createSession(account.id, "windows", NOW).token;
    const put = () => limited.request("http://tavora.test/v1/leaderboards/wellbrained.word-guess/shown", { method: "PUT", headers: { authorization: `Bearer ${token}` } });
    expect((await put()).status).toBe(200);
    expect((await put()).status).toBe(200);
    expect((await put()).status).toBe(429);
  });

  it("takes at most 50 results a request", async () => {
    const { user, show, allow, submit } = setup();
    await allow();
    const mara = user("mara@example.com");
    await show(mara.token);
    expect((await submit(mara.token, "unlimited", Array.from({ length: 51 }, () => won(NOW)))).status).toBe(400);
    expect((await submit(mara.token, "unlimited", Array.from({ length: 50 }, () => won(NOW)))).body.accepted).toHaveLength(50);
  });
});

describe("the reader's own standings (mine)", () => {
  type Mine = { boards: { id: string; periods: Record<string, Record<string, number> | null> }[] };

  it("gives the standing in every period for each board of a catalog module", async () => {
    const { user, show, allow, submit, mine } = setup();
    await allow();
    const [mara, jon] = [user("mara@example.com", "Mara"), user("jon@example.com", "Jon")];
    for (const person of [mara, jon]) await show(person.token);
    await submit(mara.token, "solved", [worth(2, NOW - 2000), worth(3, NOW - 1000)]);
    await submit(jon.token, "solved", [worth(9, NOW - 500)]);
    await submit(mara.token, "unlimited", [won(NOW - 2000), won(NOW - 1000)]);
    await submit(mara.token, "winrate", [won(NOW - 3000), won(NOW - 2000), lost(NOW - 1000)]);
    await submit(jon.token, "winrate", [won(NOW - 3000)]);
    const answer = (await mine(mara.token)).body as unknown as Mine;
    expect(answer.boards.map((board) => board.id)).toEqual(BOARDS.map((board) => board.id));
    const by = (id: string) => answer.boards.find((board) => board.id === id)!.periods;
    expect(by("solved")).toEqual({
      day: { rank: 2, of: 2, value: 5, games: 2 },
      week: { rank: 2, of: 2, value: 5, games: 2 },
      month: { rank: 2, of: 2, value: 5, games: 2 },
      year: { rank: 2, of: 2, value: 5, games: 2 },
      all: { rank: 2, of: 2, value: 5, games: 2 },
    });
    // A streak has no day period; the others hold.
    expect(by("unlimited")).toEqual({
      day: null,
      week: { rank: 1, of: 1, current: 2, best: 2 },
      month: { rank: 1, of: 1, current: 2, best: 2 },
      year: { rank: 1, of: 1, current: 2, best: 2 },
      all: { rank: 1, of: 1, current: 2, best: 2 },
    });
    // Jon has one game of the three a rate board wants, so there are none of him on it.
    expect(by("winrate").all).toEqual({ rank: 1, of: 1, value: 66.7, games: 3, wins: 2 });
    expect(by("fastest").all).toBeNull();
    // Reading another day: nothing was played on the 26th.
    const before = (await mine(mara.token, "?day=2026-10-26")).body as unknown as Mine;
    expect(before.boards.find((board) => board.id === "solved")!.periods).toMatchObject({ day: null, week: { value: 5 }, all: { value: 5 } });
  });

  it("answers 200 with every standing empty when signed out, and makes no member", async () => {
    const { leaderboards, allow, mine, user, show, submit } = setup();
    await allow();
    const mara = user("mara@example.com");
    await show(mara.token);
    await submit(mara.token, "solved", [worth(1)]);
    const reader = user("reader@example.com");
    const signedOut = await mine();
    expect(signedOut.status).toBe(200);
    expect((signedOut.body as unknown as Mine).boards).toHaveLength(BOARDS.length);
    for (const board of (signedOut.body as unknown as Mine).boards) expect(Object.values(board.periods).every((standing) => standing === null)).toBe(true);
    // A signed-in user who never played has no line either, and is no member for asking.
    expect(Object.values(((await mine(reader.token)).body as unknown as Mine).boards[0]!.periods).every((standing) => standing === null)).toBe(true);
    expect(leaderboards.isAvailable("local.copy", reader.id)).toBe(true);
    expect(leaderboards.member(reader.id, "wellbrained.word-guess").shown).toBe(false);
  });

  it("gives nothing for a module that isn't allowed, one the catalog doesn't have, or a reader who is suspended", async () => {
    const { accounts, user, show, allow, submit, mine, leaderboards } = setup();
    const mara = user("mara@example.com");
    // Not allowed yet: the boards are listed from the manifest, every standing is empty.
    expect(Object.values(((await mine(mara.token)).body as unknown as Mine).boards[0]!.periods).every((standing) => standing === null)).toBe(true);
    expect((await mine(mara.token, "", "wellbrained.unknown")).body).toEqual({ boards: [] });
    await allow();
    await show(mara.token);
    await submit(mara.token, "solved", [worth(1)]);
    expect(((await mine(mara.token)).body as unknown as Mine).boards.find((board) => board.id === "solved")!.periods.all).toMatchObject({ rank: 1, of: 1 });
    accounts.suspend(mara.id, "spam", null, NOW);
    // A suspended account is signed out, so it reads as nobody; the standing walk also skips it, which the line below checks.
    const ownLine = leaderboards.standing(mara.id, "wellbrained.word-guess", "solved", "total", { period: "all", key: "", today: "2026-10-28", skip: new Set([mara.id]), minGames: 1 });
    expect(ownLine).toBeNull();
    accounts.suspend(mara.id, "spam", null, NOW);
    expect((await mine(mara.token)).status).toBe(401);
  });

  it("takes a development copy's boards from the query, at most 20, and answers 400 for a bad list", async () => {
    const { user, show, submit, mine } = setup();
    const dev = user("dev@example.com", "Dev");
    const other = user("other@example.com", "Other");
    for (const person of [dev, other]) {
      await show(person.token, "local.word-guess");
      await submit(person.token, "solved", [worth(person === dev ? 4 : 40)], "local.word-guess", { kind: "total" });
    }
    const boards = JSON.stringify([{ id: "solved", kind: "total" }, { id: "daily", kind: "streak", daily: true }, { id: "Bad Id", kind: "total" }, { id: "odd", kind: "odd" }]);
    const answer = (await mine(dev.token, `?boards=${encodeURIComponent(boards)}`, "local.word-guess")).body as unknown as Mine;
    // Bad ids and kinds are left out; a test board has the developer's line alone.
    expect(answer.boards.map((board) => board.id)).toEqual(["solved", "daily"]);
    expect(answer.boards[0]!.periods.all).toEqual({ rank: 1, of: 1, value: 4, games: 1 });
    expect(answer.boards[1]!.periods.all).toBeNull();
    expect((await mine(dev.token, "?boards=%7Bnot", "local.word-guess")).status).toBe(400);
    expect((await mine(dev.token, `?boards=${encodeURIComponent('{"id":"solved"}')}`, "local.word-guess")).status).toBe(400);
    const many = JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ id: `b${i}`, kind: "total" })));
    expect((await mine(dev.token, `?boards=${encodeURIComponent(many)}`, "local.word-guess")).status).toBe(400);
    expect(((await mine(dev.token, "", "local.word-guess")).body as unknown as Mine).boards).toEqual([]);
    // Signed out, a test board is empty.
    expect(((await mine(undefined, `?boards=${encodeURIComponent(boards)}`, "local.word-guess")).body as unknown as Mine).boards[0]!.periods.all).toBeNull();
  });
});

describe("the results limit", () => {
  it("refuses results past the limit as full, counting every board of the module, and keeps the rest", () => {
    const store = new LeaderboardStore(":memory:", 3);
    store.show("account", "wellbrained.word-guess", NOW);
    const first = won(NOW - 3);
    expect(store.submit("account", "wellbrained.word-guess", "unlimited", "streak", [first, won(NOW - 2)], NOW).accepted).toHaveLength(2);
    const late = won(NOW);
    expect(store.submit("account", "wellbrained.word-guess", "other", "streak", [won(NOW - 1), late], NOW)).toEqual({ accepted: [expect.any(String)], rejected: [{ id: late.id, reason: "full" }] });
    // A result it already has is still taken.
    expect(store.submit("account", "wellbrained.word-guess", "unlimited", "streak", [first], NOW)).toEqual({ accepted: [first.id], rejected: [] });
    // Another module has its own room.
    store.show("account", "wellbrained.sudoku", NOW);
    expect(store.submit("account", "wellbrained.sudoku", "unlimited", "streak", [won(NOW)], NOW).rejected).toEqual([]);
  });
});

describe("the tables", () => {
  const options = { limit: 10, today: "2026-10-28", viewer: null, skip: new Set<string>() };

  it("works the standings out again when a board's declaration changes its shape", () => {
    const store = new LeaderboardStore(":memory:");
    store.show("account", "wellbrained.word-guess", NOW);
    store.submit("account", "wellbrained.word-guess", "times", "score-high", [worth(5, NOW - 2000), worth(9, NOW - 1000)], NOW);
    expect(store.top("wellbrained.word-guess", "times", "score-high", options).lines).toMatchObject([{ value: 9 }]);
    // Nothing new is sent, only the declaration is now "lowest wins".
    store.submit("account", "wellbrained.word-guess", "times", "score-low", [], NOW);
    expect(store.top("wellbrained.word-guess", "times", "score-high", options).lines).toEqual([]);
    expect(store.top("wellbrained.word-guess", "times", "score-low", options).lines).toMatchObject([{ value: 5 }]);
    expect(store.top("wellbrained.word-guess", "times", "score-low", { ...options, period: "month", key: "2026-10" }).lines).toMatchObject([{ value: 5 }]);
  });

  it("drops the tables of an older file and builds them new", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "tavora-lb-"));
    try {
      const file = path.join(folder, "leaderboards.sqlite");
      const old = new DatabaseSync(file);
      old.exec(`
        create table results (account_id text not null, module_id text not null, board text not null, id text not null, outcome text, value real, day text, at integer not null, primary key (account_id, module_id, board, id));
        create table standings (account_id text not null, module_id text not null, board text not null, shape text not null, best real not null, reached_at integer not null, current integer not null, last_day text, primary key (account_id, module_id, board));
        insert into results values ('a', 'wellbrained.word-guess', 'unlimited', 'r1', 'won', null, null, 1);
        insert into standings values ('a', 'wellbrained.word-guess', 'unlimited', 'streak', 1, 1, 1, null);
      `);
      old.close();

      const columns = (table: string) => {
        const db = new DatabaseSync(file);
        try {
          return (db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((column) => column.name);
        } finally {
          db.close();
        }
      };
      expect(columns("standings")).not.toContain("period");
      const store = new LeaderboardStore(file);
      store.show("a", "wellbrained.word-guess", NOW);
      expect(store.top("wellbrained.word-guess", "unlimited", "streak", options)).toEqual({ lines: [], of: 0 });
      expect(store.submit("a", "wellbrained.word-guess", "unlimited", "streak", [won(NOW)], NOW).accepted).toHaveLength(1);
      expect(store.top("wellbrained.word-guess", "unlimited", "streak", options).lines).toMatchObject([{ value: 1 }]);
      store.close();
      expect(columns("standings")).toEqual(expect.arrayContaining(["period", "period_key", "value", "games", "wins"]));
      expect(columns("results")).toContain("daily_day");
      // Opened again, the new tables stay.
      const again = new LeaderboardStore(file);
      expect(again.top("wellbrained.word-guess", "unlimited", "streak", options).lines).toHaveLength(1);
      again.close();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("leaderboards and the account", () => {
  it("go with a deleted account", async () => {
    const db = writeDatabase(":memory:", buildDataset({ builtIns: [], wikidata: [], steam: [] }));
    const store = new AccountStore(":memory:");
    const leaderboards = new LeaderboardStore(":memory:");
    const inbox = createTestInbox();
    const app = createApp({ db, rateLimiter: roomy(), accounts: { store, mailer: inbox, leaderboards, codeRateLimiter: roomy(), verifyRateLimiter: roomy(), now: () => NOW } });
    const account = store.createAccount({ email: "mara@example.com" }, NOW);
    const token = store.createSession(account.id, "windows", NOW).token;
    leaderboards.setAllowed("wellbrained.word-guess", true, NOW);
    leaderboards.show(account.id, "wellbrained.word-guess", NOW);
    leaderboards.submit(account.id, "wellbrained.word-guess", "unlimited", "streak", [won(NOW)], NOW);
    const post = (pathname: string, body: unknown) =>
      app.request(`http://tavora.test/v1/account${pathname}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    await post("/delete/code", {});
    const code = /\n {4}(\d{6})\n/.exec(inbox.mails()[0]?.text ?? "")?.[1];
    expect((await post("/delete", { code })).status).toBe(204);
    expect(leaderboards.top("wellbrained.word-guess", "unlimited", "streak", { limit: 10, today: "2026-10-28", viewer: null, skip: new Set() })).toEqual({ lines: [], of: 0 });
    expect(leaderboards.member(account.id, "wellbrained.word-guess").shown).toBe(false);
  });

  it("answer 503 while accounts are off", async () => {
    const db = writeDatabase(":memory:", buildDataset({ builtIns: [], wikidata: [], steam: [] }));
    const response = await createApp({ db }).request("http://tavora.test/v1/leaderboards/wellbrained.word-guess");
    expect(response.status).toBe(503);
  });
});
