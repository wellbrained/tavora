import { randomUUID } from "node:crypto";
import type { LeaderboardBoard } from "@tavora/module-schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { boardName, checkResult, dayWindow, LeaderboardStore, leaderboardRoutes, leaderboardsAdminRoutes, liveStreak, streakOf, type Played } from "./leaderboards.ts";
import { createTestInbox } from "./mail.ts";
import { createRateLimiter } from "./rate-limit.ts";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const HOUR = 3_600_000;
const DAY_MS = 24 * HOUR;
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });

const BOARDS: LeaderboardBoard[] = [
  { id: "unlimited", kind: "streak" },
  { id: "daily", kind: "streak", daily: true },
  { id: "fastest", kind: "score", order: "low" },
  { id: "points", kind: "score" },
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
  return { accounts, leaderboards, clock, user, call, adminCall, allow, show, submit, top };
}

const won = (at: number, day?: string) => ({ id: randomUUID(), outcome: "won", at, ...(day ? { day } : {}) });
const lost = (at: number, day?: string) => ({ id: randomUUID(), outcome: "lost", at, ...(day ? { day } : {}) });

describe("checking one result", () => {
  it("takes a well-formed result and keeps the id lowercase", () => {
    const id = randomUUID().toUpperCase();
    expect(checkResult({ id, outcome: "won", at: NOW }, "streak", NOW)).toEqual({ ok: { id: id.toLowerCase(), at: NOW, outcome: "won", value: null, day: null } });
    expect(checkResult({ id, value: 61_500, at: NOW }, "score-low", NOW)).toEqual({ ok: { id: id.toLowerCase(), at: NOW, outcome: null, value: 61_500, day: null } });
  });

  it("says why it refuses one, by the id it was sent with", () => {
    const id = randomUUID();
    expect(checkResult({ id: "run-1", outcome: "won", at: NOW }, "streak", NOW)).toEqual({ id: "run-1", reason: "invalid" });
    expect(checkResult({ id, outcome: "draw", at: NOW }, "streak", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, value: Number.NaN, at: NOW }, "score-high", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, value: 1e13, at: NOW }, "score-high", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, outcome: "won", at: NOW }, "streak-daily", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, outcome: "won", at: NOW, day: "2026-02-30" }, "streak-daily", NOW)).toEqual({ id, reason: "invalid" });
    expect(checkResult({ id, outcome: "won", at: NOW + HOUR }, "streak", NOW)).toEqual({ id, reason: "time" });
    expect(checkResult({ id, outcome: "won", at: NOW - 400 * 24 * HOUR }, "streak", NOW)).toEqual({ id, reason: "time" });
    // Without a string id there is nothing to name in the answer.
    expect(checkResult({ outcome: "won", at: NOW }, "streak", NOW)).toBeNull();
    expect(checkResult("won", "streak", NOW)).toBeNull();
  });

  it("counts a daily result only when it ended within its day somewhere on earth", () => {
    const { from, to } = dayWindow("2026-10-28");
    expect(new Date(from).toISOString()).toBe("2026-10-27T10:00:00.000Z");
    expect(new Date(to).toISOString()).toBe("2026-10-29T12:00:00.000Z");
    const id = randomUUID();
    expect(checkResult({ id, outcome: "won", at: from, day: "2026-10-28" }, "streak-daily", NOW)).toHaveProperty("ok");
    expect(checkResult({ id, outcome: "won", at: from - 1, day: "2026-10-28" }, "streak-daily", NOW + DAY_MS)).toEqual({ id, reason: "archive" });
    // An archive replay: yesterday's puzzle, played today.
    expect(checkResult({ id, outcome: "won", at: NOW, day: "2026-10-20" }, "streak-daily", NOW)).toEqual({ id, reason: "archive" });
    // The day is ignored on a board that isn't daily.
    expect(checkResult({ id, outcome: "won", at: NOW, day: "2026-10-20" }, "streak", NOW)).toHaveProperty("ok.day", null);
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
    const bad = { id: randomUUID(), outcome: "maybe", at: NOW };
    const future = won(NOW + HOUR);
    const answer = await submit(mara.token, "unlimited", [first, bad, won(NOW - 2000), future, { outcome: "won" }, won(NOW - 1000)]);
    expect(answer.body).toEqual({
      accepted: [first.id, expect.any(String), expect.any(String)],
      rejected: [
        { id: bad.id, reason: "invalid" },
        { id: future.id, reason: "time" },
      ],
    });
    expect(await top("unlimited", mara.token)).toEqual([{ rank: 1, name: "Mara", self: true, current: 3, best: 3 }]);
    // Again, with a loss on top: the old ones count once.
    expect((await submit(mara.token, "unlimited", [first, lost(NOW)])).body).toMatchObject({ accepted: [first.id, expect.any(String)], rejected: [] });
    expect(await top("unlimited", mara.token)).toEqual([{ rank: 1, name: "Mara", self: true, current: 0, best: 3 }]);
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
    expect(await top("daily", mara.token, "?day=2026-10-28")).toEqual([{ rank: 1, name: "Mara", self: true, current: 2, best: 2 }]);
    // Two days later without playing, the streak has ended; its best stays. A day the server can't be on yet reads as its today.
    expect(await top("daily", mara.token, "?day=2026-10-30")).toEqual([{ rank: 1, name: "Mara", self: true, current: 2, best: 2 }]);
    clock.now += 2 * DAY_MS;
    expect(await top("daily", mara.token, "?day=2026-10-30")).toEqual([{ rank: 1, name: "Mara", self: true, current: 0, best: 2 }]);
  });

  it("ranks score boards by each user's best, the lowest first where low wins, and shares ranks on a tie", async () => {
    const { user, show, allow, submit, top } = setup();
    await allow();
    const [mara, jon, ida] = [user("mara@example.com", "Mara"), user("jon@example.com", "Jon"), user("ida@example.com", "Ida")];
    for (const person of [mara, jon, ida]) await show(person.token);
    await submit(mara.token, "fastest", [{ id: randomUUID(), value: 90_000, at: NOW - 5000 }, { id: randomUUID(), value: 70_000, at: NOW - 4000 }]);
    await submit(jon.token, "fastest", [{ id: randomUUID(), value: 70_000, at: NOW - 3000 }]);
    await submit(ida.token, "fastest", [{ id: randomUUID(), value: 80_000, at: NOW - 2000 }]);
    expect(await top("fastest", jon.token)).toEqual([
      { rank: 1, name: "Mara", self: false, value: 70_000 },
      { rank: 1, name: "Jon", self: true, value: 70_000 },
      { rank: 3, name: "Ida", self: false, value: 80_000 },
    ]);
    await submit(ida.token, "points", [{ id: randomUUID(), value: 12, at: NOW }, { id: randomUUID(), value: 40, at: NOW }]);
    expect(await top("points")).toEqual([{ rank: 1, name: "Ida", self: false, value: 40 }]);
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
      { rank: 1, name: "A", self: false, current: 3, best: 3 },
      { rank: 3, name: "C", self: true, current: 1, best: 1 },
    ]);
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
    const names = ((await top("unlimited")) as { name: string | null; rank: number }[]).map((row) => [row.rank, row.name]);
    expect(names).toEqual([
      [1, null],
      [1, null],
    ]);
  });

  it("deletes a user's results for the module when they switch it off", async () => {
    const { user, show, allow, submit, top, call } = setup();
    await allow();
    const mara = user("mara@example.com");
    await show(mara.token);
    await submit(mara.token, "unlimited", [won(NOW)]);
    await submit(mara.token, "fastest", [{ id: randomUUID(), value: 1, at: NOW }]);
    expect((await call("DELETE", "/wellbrained.word-guess/shown", mara.token)).body).toMatchObject({ shown: false });
    expect(await top("unlimited")).toEqual([]);
    expect(await top("fastest")).toEqual([]);
    // Shown again: nothing comes back, the board starts fresh.
    await show(mara.token);
    expect(await top("unlimited")).toEqual([]);
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
    expect(await top("daily", dev.token, "?kind=streak&daily=1", "local.word-guess")).toEqual([{ rank: 1, name: "Dev", self: true, current: 1, best: 1 }]);
    expect(await top("daily", undefined, "?kind=streak&daily=1", "local.word-guess")).toEqual([]);
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
    expect(leaderboards.top("wellbrained.word-guess", "unlimited", "streak", { limit: 10, today: "2026-10-28", viewer: null, skip: new Set() })).toEqual([]);
    expect(leaderboards.member(account.id, "wellbrained.word-guess").shown).toBe(false);
  });

  it("answer 503 while accounts are off", async () => {
    const db = writeDatabase(":memory:", buildDataset({ builtIns: [], wikidata: [], steam: [] }));
    const response = await createApp({ db }).request("http://tavora.test/v1/leaderboards/wellbrained.word-guess");
    expect(response.status).toBe(503);
  });
});
