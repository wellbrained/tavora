import { afterEach, describe, expect, it, vi } from "vitest";
import { localDate, msUntilMidnight, onItsDay, openRuns, previousDate, runStatistics, type RunBase, type RunSummary } from "./runs.js";
import { createMemoryHost } from "./testing.js";

interface Game extends RunBase {
  difficulty: "easy" | "hard";
  moves: number;
  uploaded?: boolean;
}

const MINUTE = 60_000;
const at = (date: string, time = "12:00:00") => new Date(`${date}T${time}`).getTime();

const isGame = (value: unknown): value is Game => !!value && typeof value === "object" && typeof (value as Game).id === "string" && Array.isArray((value as { cells?: unknown }).cells) === false && typeof (value as Game).moves === "number";

function game(partial: Partial<Game> & Pick<Game, "id">): Game {
  return {
    mode: "daily",
    difficulty: "easy",
    date: "2026-10-30",
    ranked: false,
    startedAt: at("2026-10-30"),
    deadline: null,
    status: "playing",
    finishedAt: null,
    rankedOutcome: null,
    rankedAt: null,
    moves: 0,
    ...partial,
  };
}

const finished = (id: string, finishedAt: number, extra: Partial<Game> = {}) => game({ id, mode: "unlimited", status: "won", finishedAt, startedAt: finishedAt - 1_000, ...extra });

function open(share?: ReturnType<typeof createMemoryHost>["host"], extra: { now?: () => number; keep?: number } = {}) {
  const { sdk, host } = createMemoryHost(share ? { share } : {});
  const runs = openRuns<Game>(sdk, {
    validate: isGame,
    awaitsUpload: (run) => run.rankedOutcome !== null && !run.uploaded,
    groups: ["easy", "hard"],
    groupOf: (run) => run.difficulty,
    ...extra,
  });
  return { runs, host, sdk };
}

afterEach(() => vi.useRealTimers());

describe("start", () => {
  it("saves a daily run per day and group, and returns the first one when two panels start the same day", async () => {
    const first = open();
    const second = open(first.host);
    const mine = await first.runs.start(game({ id: "a" }));
    const theirs = await second.runs.start(game({ id: "b" }));
    expect(mine.id).toBe("a");
    expect(theirs.id).toBe("a");
    expect(first.host.appStorage.get("daily:2026-10-30:easy")).toMatchObject({ id: "a" });

    expect((await second.runs.start(game({ id: "c", difficulty: "hard" }))).id).toBe("c");
    expect(first.host.appStorage.get("daily:2026-10-30:hard")).toMatchObject({ id: "c" });
  });

  it("saves an unlimited run, and returns the one still being played in that group", async () => {
    const first = open();
    const second = open(first.host);
    await first.runs.start(game({ id: "u1", mode: "unlimited" }));
    expect(first.host.appStorage.get("run:u1")).toMatchObject({ id: "u1" });
    expect(first.host.appStorage.get("unlimited:active:easy")).toBe("u1");

    expect((await second.runs.start(game({ id: "u2", mode: "unlimited" }))).id).toBe("u1");
    expect((await second.runs.start(game({ id: "u3", mode: "unlimited", difficulty: "hard" }))).id).toBe("u3");

    await first.runs.finish("u1", "won");
    expect((await second.runs.start(game({ id: "u4", mode: "unlimited" }))).id).toBe("u4");
  });

  it("works without groups, with the plain key names", async () => {
    const { sdk, host } = createMemoryHost();
    const runs = openRuns<Game>(sdk, { validate: isGame, awaitsUpload: () => false });
    await runs.start(game({ id: "a" }));
    await runs.start(game({ id: "u", mode: "unlimited" }));
    expect(host.appStorage.get("daily:2026-10-30")).toMatchObject({ id: "a" });
    expect(host.appStorage.get("unlimited:active")).toBe("u");
  });

  it("uses the key scheme it is given", async () => {
    const { sdk, host } = createMemoryHost();
    const runs = openRuns<Game>(sdk, { validate: isGame, awaitsUpload: () => false, keys: { daily: (date) => `d-${date}`, prefixes: ["d-", "run:"] } });
    await runs.start(game({ id: "a" }));
    expect(host.appStorage.get("d-2026-10-30")).toMatchObject({ id: "a" });
    expect((await runs.load()).runs.map((run) => run.id)).toEqual(["a"]);
  });
});

describe("load", () => {
  it("reads runs and summaries and leaves other keys and invalid values out", async () => {
    const { runs, host } = open();
    host.appStorage.set("daily:2026-10-29:easy", game({ id: "a", date: "2026-10-29" }) as never);
    host.appStorage.set("run:x", { nonsense: true });
    host.appStorage.set("options", { sound: true });
    host.appStorage.set("unlimited:summary:hard", { played: 3, wins: 2, current: 1, best: 2, through: 10 });
    host.appStorage.set("unlimited:summary:easy", { played: "many" });
    const loaded = await runs.load();
    expect(loaded.runs.map((run) => run.id)).toEqual(["a"]);
    expect(loaded.summaries).toEqual({ hard: { played: 3, wins: 2, current: 1, best: 2, through: 10 } });
    expect(runs.runs).toBe(loaded.runs);
  });
});

describe("change", () => {
  it("applies the edit to the newest copy and keeps both panels' changes", async () => {
    const first = open();
    const second = open(first.host);
    const mine = await first.runs.start(game({ id: "a", moves: 0 }));
    await second.runs.load();
    await Promise.all([first.runs.change(mine, (run) => void (run.moves += 1)), second.runs.change("a", (run) => void (run.moves += 10))]);
    expect(first.host.appStorage.get("daily:2026-10-30:easy")).toMatchObject({ moves: 11 });
  });

  it("returns null for a run that is gone, and for one it never knew", async () => {
    const first = open();
    const second = open(first.host);
    const saved = await first.runs.start(game({ id: "a" }));
    await first.sdk.storage.app.delete("daily:2026-10-30:easy");
    expect(await first.runs.change(saved, () => {})).toBeNull();
    expect(first.runs.runs).toEqual([]);
    expect(await second.runs.change("nope", () => {})).toBeNull();
  });

  it("gives up with CONFLICT when another panel keeps winning", async () => {
    const { runs, host } = open();
    const saved = await runs.start(game({ id: "a" }));
    const real = host.appStorage;
    let n = 0;
    host.answer("storage.app.compareAndSet", () => {
      real.set("daily:2026-10-30:easy", { ...saved, moves: ++n } as never);
      return false;
    });
    await expect(runs.change(saved, (run) => void (run.moves = -1))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(n).toBe(5);
  });

  it("never counts a move after the deadline: the run ends first, at the deadline", async () => {
    const clock = { now: at("2026-10-30") + 10 * MINUTE };
    const { runs } = open(undefined, { now: () => clock.now });
    const run = await runs.start(game({ id: "u", mode: "unlimited", ranked: true, startedAt: at("2026-10-30"), deadline: at("2026-10-30") + 15 * MINUTE }));

    const inTime = await runs.change(run, (saved) => void (saved.moves += 1));
    expect(inTime).toMatchObject({ moves: 1, status: "playing" });

    clock.now = at("2026-10-30") + 16 * MINUTE;
    const late = await runs.change(run, (saved) => void (saved.moves += 1));
    expect(late).toMatchObject({ moves: 1, status: "lost", finishedAt: at("2026-10-30") + 15 * MINUTE, rankedOutcome: "lost", rankedAt: at("2026-10-30") + 15 * MINUTE });
  });

  it("expires a run whose time is up, and leaves one that has time", async () => {
    const clock = { now: at("2026-10-30") };
    const { runs } = open(undefined, { now: () => clock.now });
    const run = await runs.start(game({ id: "u", mode: "unlimited", ranked: true, deadline: at("2026-10-30") + MINUTE }));
    expect((await runs.expire(run))?.status).toBe("playing");
    clock.now += 2 * MINUTE;
    expect((await runs.expire("u"))?.status).toBe("lost");
  });

  it("finishes a ranked run with its leaderboard result, once", async () => {
    const clock = { now: 5_000 };
    const { runs } = open(undefined, { now: () => clock.now });
    await runs.start(game({ id: "u", mode: "unlimited", ranked: true }));
    expect(await runs.finish("u", "won")).toMatchObject({ status: "won", finishedAt: 5_000, rankedOutcome: "won", rankedAt: 5_000 });
    clock.now = 9_000;
    expect(await runs.finish("u", "lost")).toMatchObject({ status: "won", finishedAt: 5_000, rankedOutcome: "won" });
  });

  it("turns a ranked run casual as a lost ranked result", async () => {
    const clock = { now: 7_000 };
    const { runs } = open(undefined, { now: () => clock.now });
    await runs.start(game({ id: "u", mode: "unlimited", ranked: true, deadline: 99_000 }));
    expect(await runs.makeCasual("u")).toMatchObject({ ranked: false, deadline: null, rankedOutcome: "lost", rankedAt: 7_000, status: "playing" });
    expect(await runs.makeCasual("u")).toMatchObject({ rankedAt: 7_000 });
  });

  it("tells listeners about every change", async () => {
    const { runs } = open();
    const seen: number[] = [];
    const off = runs.onChange((all) => seen.push(all.length));
    await runs.start(game({ id: "a" }));
    await runs.change("a", (run) => void (run.moves = 1));
    off();
    await runs.change("a", (run) => void (run.moves = 2));
    expect(seen).toEqual([1, 1]);
  });
});

describe("fold", () => {
  async function filled(extra: { keep?: number } = {}) {
    const first = open(undefined, { keep: 2, ...extra });
    for (let i = 1; i <= 5; i++) first.host.appStorage.set(`run:r${i}`, finished(`r${i}`, i * 1_000) as never);
    await first.runs.load();
    return first;
  }

  it("folds the oldest finished unlimited runs into the summary and keeps the newest", async () => {
    const { runs, host } = await filled();
    await runs.fold();
    expect(Object.keys(host.appStorage.entries()).sort()).toEqual(["run:r4", "run:r5", "unlimited:summary:easy"]);
    expect(host.appStorage.get("unlimited:summary:easy")).toEqual({ played: 3, wins: 3, current: 3, best: 3, through: 3_000 });
    expect(runs.runs.map((run) => run.id)).toEqual(["r4", "r5"]);
    expect(runs.statistics("unlimited", "easy", "2026-10-30")).toEqual({ played: 5, wins: 5, current: 5, best: 5 });
  });

  it("keeps ranked runs until they are uploaded, and everything after them", async () => {
    const { runs, host } = await filled();
    host.appStorage.set("run:r2", finished("r2", 2_000, { ranked: true, rankedOutcome: "won", rankedAt: 2_000 }) as never);
    await runs.load();
    await runs.fold();
    expect(Object.keys(host.appStorage.entries()).sort()).toEqual(["run:r2", "run:r3", "run:r4", "run:r5", "unlimited:summary:easy"]);
    expect(host.appStorage.get("unlimited:summary:easy")).toMatchObject({ played: 1, through: 1_000 });

    host.appStorage.set("run:r2", finished("r2", 2_000, { ranked: true, rankedOutcome: "won", rankedAt: 2_000, uploaded: true }) as never);
    await runs.load();
    await runs.fold();
    expect(Object.keys(host.appStorage.entries()).sort()).toEqual(["run:r4", "run:r5", "unlimited:summary:easy"]);
  });

  it("leaves daily runs and runs still being played alone", async () => {
    const { runs, host } = await filled();
    host.appStorage.set("daily:2026-10-01:easy", game({ id: "d", date: "2026-10-01", status: "won", finishedAt: 1 }) as never);
    host.appStorage.set("run:p", finished("p", 0, { status: "playing", finishedAt: null }) as never);
    await runs.load();
    await runs.fold();
    expect(host.appStorage.get("daily:2026-10-01:easy")).not.toBeNull();
    expect(host.appStorage.get("run:p")).not.toBeNull();
  });

  it("folds each group on its own", async () => {
    const { runs, host } = await filled();
    for (let i = 1; i <= 3; i++) host.appStorage.set(`run:h${i}`, finished(`h${i}`, i * 1_000, { difficulty: "hard" }) as never);
    await runs.load();
    await runs.fold();
    expect(host.appStorage.get("unlimited:summary:hard")).toMatchObject({ played: 1, through: 1_000 });
    expect(host.appStorage.get("unlimited:summary:easy")).toMatchObject({ played: 3 });
  });

  it("yields to another panel that folded first: nothing is deleted", async () => {
    const mine = await filled();
    const theirs = open(mine.host, { keep: 2 });
    await theirs.runs.load();
    await theirs.runs.fold();
    const summary = mine.host.appStorage.get("unlimited:summary:easy") as unknown as RunSummary;
    expect(summary.through).toBe(3_000);

    mine.host.appStorage.set("run:r1", finished("r1", 1_000) as never);
    await mine.runs.fold();
    expect(mine.host.appStorage.get("unlimited:summary:easy")).toEqual(summary);
    expect(mine.host.appStorage.get("run:r1")).not.toBeNull();
  });

  it("does nothing while the runs fit", async () => {
    const { runs, host } = await filled({ keep: 10 });
    await runs.fold();
    expect(host.appStorage.get("unlimited:summary:easy")).toBeNull();
  });
});

describe("statistics", () => {
  const daily = (date: string, status: "won" | "lost", finishedOn = date) => game({ id: date, date, status, finishedAt: at(finishedOn) });

  it("counts consecutive days won, broken by a loss or a missed day", () => {
    const runs = [daily("2026-10-25", "won"), daily("2026-10-26", "won"), daily("2026-10-27", "lost"), daily("2026-10-28", "won"), daily("2026-10-29", "won"), daily("2026-10-30", "won")];
    expect(runStatistics(runs, "daily", "2026-10-30")).toEqual({ played: 6, wins: 5, current: 3, best: 3 });
    expect(runStatistics([daily("2026-10-25", "won"), daily("2026-10-27", "won")], "daily", "2026-10-27")).toEqual({ played: 2, wins: 2, current: 1, best: 1 });
  });

  it("does not break a streak with today's unplayed puzzle, but a missed day does", () => {
    const runs = [daily("2026-10-28", "won"), daily("2026-10-29", "won")];
    expect(runStatistics(runs, "daily", "2026-10-30").current).toBe(2);
    expect(runStatistics(runs, "daily", "2026-10-31").current).toBe(0);
    expect(runStatistics(runs, "daily", "2026-10-31").best).toBe(2);
  });

  it("counts an archive run as played but not for the streak", () => {
    const runs = [daily("2026-10-28", "won", "2026-10-30"), daily("2026-10-30", "won")];
    expect(runStatistics(runs, "daily", "2026-10-30")).toEqual({ played: 2, wins: 2, current: 1, best: 1 });
  });

  it("counts consecutive unlimited wins from the summary on, and ignores runs it already holds", () => {
    const summary: RunSummary = { played: 10, wins: 8, current: 4, best: 6, through: 5_000 };
    const runs = [finished("old", 4_000, { status: "lost" }), finished("a", 6_000), finished("b", 7_000), finished("c", 8_000, { status: "lost" }), finished("d", 9_000)];
    expect(runStatistics(runs, "unlimited", "2026-10-30", summary)).toEqual({ played: 14, wins: 11, current: 1, best: 6 });
    expect(runStatistics([finished("a", 1), finished("b", 2)], "unlimited", "x")).toEqual({ played: 2, wins: 2, current: 2, best: 2 });
  });

  it("keeps groups apart", async () => {
    const { runs, host } = open();
    host.appStorage.set("run:a", finished("a", 1_000) as never);
    host.appStorage.set("run:b", finished("b", 2_000, { difficulty: "hard", status: "lost" }) as never);
    await runs.load();
    expect(runs.statistics("unlimited", "easy", "x")).toEqual({ played: 1, wins: 1, current: 1, best: 1 });
    expect(runs.statistics("unlimited", "hard", "x")).toEqual({ played: 1, wins: 0, current: 0, best: 0 });
  });
});

describe("dates", () => {
  it("names the local calendar day, also right before and after midnight", () => {
    expect(localDate(new Date(2026, 9, 30, 23, 59, 59, 999))).toBe("2026-10-30");
    expect(localDate(new Date(2026, 9, 31, 0, 0, 0, 0))).toBe("2026-10-31");
    expect(localDate(new Date(2026, 0, 1, 0, 0, 0))).toBe("2026-01-01");
    expect(localDate(new Date(2026, 11, 31, 23, 0, 0).getTime())).toBe("2026-12-31");
  });

  it("counts down to the next local midnight", () => {
    expect(msUntilMidnight(new Date(2026, 9, 30, 23, 59, 59).getTime())).toBe(1_000);
    expect(msUntilMidnight(new Date(2026, 9, 31, 0, 0, 0).getTime())).toBe(24 * 60 * MINUTE);
    expect(msUntilMidnight(new Date(2026, 11, 31, 12, 0, 0).getTime())).toBe(12 * 60 * MINUTE);
  });

  it("follows a fake clock across midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 30, 23, 59, 59));
    expect(localDate()).toBe("2026-10-30");
    vi.advanceTimersByTime(msUntilMidnight(Date.now()));
    expect(localDate()).toBe("2026-10-31");
  });

  it("goes back one calendar day over month, year and leap day", () => {
    expect(previousDate("2026-10-30")).toBe("2026-10-29");
    expect(previousDate("2026-11-01")).toBe("2026-10-31");
    expect(previousDate("2027-01-01")).toBe("2026-12-31");
    expect(previousDate("2028-03-01")).toBe("2028-02-29");
  });

  it("counts a daily run for its own day only", () => {
    const run = { date: "2026-10-30", finishedAt: new Date(2026, 9, 30, 23, 59, 59).getTime() };
    expect(onItsDay(run)).toBe(true);
    expect(onItsDay({ ...run, finishedAt: new Date(2026, 9, 31, 0, 0, 1).getTime() })).toBe(false);
    expect(onItsDay({ ...run, finishedAt: null })).toBe(false);
  });
});

