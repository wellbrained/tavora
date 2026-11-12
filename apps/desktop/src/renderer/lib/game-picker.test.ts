import { describe, expect, it } from "vitest";
import type { CatalogModuleView, InstalledGameView } from "../../shared/host-api";
import type { WorkspaceView } from "../../shared/host-api";
import { addedWithGame, addInputFor, buildRows, describeActivity, initials, keepActive, keepOrder, modulesFor, optionId, playedLately, resolveAddInput, stepActive, withLiveCopies } from "./game-picker";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 10, 1, 12).getTime();

const installed = (name: string, extra: Partial<InstalledGameView> = {}): InstalledGameView => ({
  key: `n:${name.toLowerCase()}`,
  name,
  steamAppId: null,
  catalogId: null,
  icon: null,
  activity: null,
  workspaceId: null,
  ...extra,
});

const module = (id: string, gameIds: string[], extra: Partial<CatalogModuleView> = {}): CatalogModuleView =>
  ({ id, name: id, gameIds, official: false, ...extra }) as CatalogModuleView;

describe("buildRows", () => {
  const pc = [installed("Zelda"), installed("Elden Ring", { catalogId: "elden-ring" })];

  it("lists the games on this PC in the order given when nothing is typed", () => {
    const rows = buildRows(pc, [{ id: "factorio", name: "Factorio" }], [], "");
    expect(rows.map((row) => row.name)).toEqual(["Zelda", "Elden Ring"]);
  });

  it("searches this PC first, then the built-in list, then the online list, one row per game", () => {
    const rows = buildRows(pc, [{ id: "elden-ring", name: "Elden Ring" }, { id: "eldoran", name: "Eldoran" }], [{ id: "eldoran", name: "Eldoran", steamAppId: null }, { id: "eldevin", name: "Eldevin", steamAppId: null }], "eld");
    expect(rows.map((row) => [row.name, row.section])).toEqual([
      ["Elden Ring", "pc"],
      ["Zelda", "pc"],
      ["Eldoran", "catalog"],
      ["Eldevin", "online"],
    ]);
    expect(rows.find((row) => row.name === "Eldoran")?.online).toBeNull();
    expect(rows.find((row) => row.name === "Eldevin")?.online).not.toBeNull();
  });

  it("only adds rows below the others as answers come in, so nothing shown moves", () => {
    const matches = [{ id: "eldoran", name: "Eldoran" }];
    const online = [{ id: "eldevin", name: "Eldevin", steamAppId: null }, { id: "aardvark-eld", name: "Aardvark Eld", steamAppId: null }];
    const keys = (rows: { key: string }[]) => rows.map((row) => row.key);
    const pcOnly = keys(buildRows(pc, [], [], "eld"));
    const withBuiltIn = keys(buildRows(pc, matches, [], "eld"));
    const withOnline = keys(buildRows(pc, matches, online, "eld"));
    expect(withBuiltIn.slice(0, pcOnly.length)).toEqual(pcOnly);
    expect(withOnline.slice(0, withBuiltIn.length)).toEqual(withBuiltIn);
    expect(withOnline).toHaveLength(withBuiltIn.length + 2);
  });

  it("keeps a game the user has in its place, marked by its workspace", () => {
    const rows = buildRows([installed("Elden Ring", { catalogId: "elden-ring", workspaceId: "elden-ring" })], [], [], "");
    expect(rows[0]!.workspaceId).toBe("elden-ring");
  });

  it("shows this PC's copy of a built-in game found by another name", () => {
    const diablo = installed("Diablo® IV", { catalogId: "diablo-4" });
    const rows = buildRows([diablo], [{ id: "diablo-4", name: "Diablo IV" }], [], "diablo 4");
    expect(rows).toEqual([expect.objectContaining({ key: diablo.key, installed: diablo, section: "catalog" })]);
  });
});

describe("a game on this PC that only the online search knows", () => {
  const nineKings = installed("9 Kings", { steamAppId: 2784470 });
  const online = [{ id: "9-kings", name: "9 Kings", steamAppId: 2784470 }];

  it("is one row, with the online game's id", () => {
    const rows = buildRows([nineKings], [], online, "9 king");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "9 Kings", gameId: "9-kings", installed: nineKings, section: "pc" });
  });

  it("is added as the online game, as plain data", () => {
    const [row] = buildRows([nineKings], [], online, "9 king");
    const input = addInputFor(row!, "9 king");
    expect(input).toEqual({ online: { id: "9-kings", name: "9 Kings", steamAppId: 2784470 } });
    expect((input as { online: object }).online).not.toBe(online[0]);
  });

  it("still shows when only the online name fits what was typed, below the rest", () => {
    const pcName = installed("9 Kings®", { steamAppId: 2784470 });
    const rows = buildRows([pcName], [], [{ id: "9-kings", name: "Nine Kings", steamAppId: 2784470 }], "nine kings");
    expect(rows.map((row) => [row.gameId, row.section])).toEqual([["9-kings", "online"]]);
    expect(rows[0]!.installed).toBe(pcName);
  });

  it("leaves a game already added as it is", () => {
    const added = installed("9 Kings", { steamAppId: 2784470, workspaceId: "local-9-kings" });
    const rows = buildRows([added], [], online, "9 king");
    expect(rows.find((row) => row.installed)?.gameId).toBeNull();
  });

  it("is added by name with its Steam app id when the search doesn't know it", () => {
    const [row] = buildRows([nineKings], [], [], "9 king");
    expect(addInputFor(row!, "9 king")).toEqual({ name: "9 Kings", steamAppId: 2784470 });
  });

  it("without a Steam app id is added by its name alone", () => {
    const [row] = buildRows([installed("Fortnite")], [], [], "");
    expect(addInputFor(row!, "")).toEqual({ name: "Fortnite" });
    expect(addInputFor(null, "My Own Game")).toEqual({ name: "My Own Game" });
  });
});

describe("playedLately", () => {
  const played = (name: string, days: number, extra: Partial<InstalledGameView> = {}) => installed(name, { activity: { kind: "played", at: NOW - days * DAY }, ...extra });
  const added = (name: string, days: number) => installed(name, { activity: { kind: "installed", at: NOW - days * DAY } });

  it("takes the games not added yet, the last played first, then the last installed, four at most", () => {
    const games = [added("New Install", 0), played("Old", 30), played("Hades", 1), installed("Never"), played("Owned", 0, { workspaceId: "owned" }), played("Rust", 3), added("Older Install", 9)];
    expect(playedLately(games).map((game) => game.name)).toEqual(["Hades", "Rust", "Old", "New Install"]);
    expect(playedLately(games, [], 10).map((game) => game.name)).toEqual(["Hades", "Rust", "Old", "New Install", "Older Install", "Never"]);
  });

  it("counts a game whose only copy is in Trash as not added (it has no workspace)", () => {
    // The main process names only live workspaces; a copy in Trash leaves workspaceId null.
    expect(playedLately([played("Trashed", 1)]).map((game) => game.name)).toEqual(["Trashed"]);
  });

  it("is empty without games on this PC, or with all of them added", () => {
    expect(playedLately([])).toEqual([]);
    expect(playedLately([played("Owned", 0, { workspaceId: "owned" })])).toEqual([]);
  });

  it("keeps the covers shown in their places when the list is found again, also one added since; only free places fill up", () => {
    const shown = playedLately([played("Hades", 1), played("Rust", 3)]).map((game) => game.key);
    // Found again: Celeste was played since, Hades was added, and a fourth game turned up.
    const again = [played("Celeste", 0), played("Hades", 1, { workspaceId: "local-hades" }), played("Rust", 3), played("Zelda", 5), played("Old", 30)];
    expect(playedLately(again, shown).map((game) => game.name)).toEqual(["Hades", "Rust", "Celeste", "Zelda"]);
    // A cover whose game is gone from this PC leaves its place.
    expect(playedLately([played("Rust", 3)], shown).map((game) => game.name)).toEqual(["Rust"]);
  });
});

describe("keepOrder", () => {
  const item = (key: string) => ({ key });
  const keys = (items: { key: string }[]) => items.map((entry) => entry.key);

  it("keeps what was shown in its places and adds the rest below, whatever order the new answer has", () => {
    // Late games from this PC rank first in the new answer, an online one sits above the typed name: neither moves a shown row.
    expect(keys(keepOrder(["eldoran", "custom:"], [item("elden-ring"), item("eldoran"), item("eldevin"), item("custom:")]))).toEqual(["eldoran", "custom:", "elden-ring", "eldevin"]);
  });

  it("drops what is gone and starts over from an empty list", () => {
    expect(keys(keepOrder(["a", "b", "c"], [item("c"), item("a")]))).toEqual(["a", "c"]);
    expect(keys(keepOrder([], [item("b"), item("a")]))).toEqual(["b", "a"]);
  });
});

describe("withLiveCopies", () => {
  const workspace = (id: string, name: string, extra: Partial<WorkspaceView> = {}) => ({ id, name, kind: "game", steamAppId: null, ...extra }) as WorkspaceView;

  it("marks each game by the library as it is now: added since, put in Trash since, or a personal workspace", () => {
    const games = [
      installed("Hades", { steamAppId: 1145360 }),
      installed("Rust", { workspaceId: "local-rust" }),
      installed("DOOM", { steamAppId: 379720 }),
      installed("Fortnite"),
      installed("Elden Ring", { catalogId: "elden-ring" }),
    ];
    const live = withLiveCopies(games, {
      "local-hades": workspace("local-hades", "Hades II", { steamAppId: 1145360 }),
      "local-doom": workspace("local-doom", "Doom", { steamAppId: 2280 }),
      "local-fortnite": workspace("local-fortnite", "Fortnite", { kind: "personal" }),
      "elden-ring": workspace("elden-ring", "Elden Ring"),
    });
    expect(live.map((game) => [game.name, game.workspaceId])).toEqual([
      ["Hades", "local-hades"],
      ["Rust", null],
      ["DOOM", null],
      ["Fortnite", null],
      ["Elden Ring", "elden-ring"],
    ]);
  });
});

describe("optionId", () => {
  it("names an option by its key, the same for the list and the search", () => {
    expect(optionId("game-results", "steam:570")).toBe("game-results-option-steam:570");
  });
});

describe("resolveAddInput", () => {
  const row = (game: InstalledGameView) => buildRows([game], [], [], "")[0]!;
  const answer = (games: { id: string; name: string; steamAppId: number | null }[]) => async () => ({ status: "ok" as const, games });

  it("looks a game on this PC that no list knew up online by its Steam app id, so it gets its id and modules", async () => {
    const pick = row(installed("Nine Kings", { steamAppId: 2784470 }));
    const search = answer([{ id: "9-kings-x", name: "9 Kings: Other", steamAppId: 1 }, { id: "9-kings", name: "9 Kings", steamAppId: 2784470 }]);
    expect(await resolveAddInput(pick, pick.name, search)).toEqual({ input: { online: { id: "9-kings", name: "9 Kings", steamAppId: 2784470 } }, gameId: "9-kings" });
  });

  it("adds it by name with its Steam app id when the search doesn't know it or can't be asked", async () => {
    const pick = row(installed("Nine Kings", { steamAppId: 2784470 }));
    expect(await resolveAddInput(pick, pick.name, answer([{ id: "x", name: "Nine Kings", steamAppId: 5 }]))).toEqual({ input: { name: "Nine Kings", steamAppId: 2784470 }, gameId: null });
    expect(await resolveAddInput(pick, pick.name, () => Promise.reject(new Error("offline")))).toEqual({ input: { name: "Nine Kings", steamAppId: 2784470 }, gameId: null });
  });

  it("asks nothing for a game a list knows, one without a Steam app id, or the typed name", async () => {
    const search = async () => {
      throw new Error("not asked");
    };
    const known = row(installed("Elden Ring", { catalogId: "elden-ring", steamAppId: 1245620 }));
    expect(await resolveAddInput(known, known.name, search)).toEqual({ input: { catalogId: "elden-ring" }, gameId: "elden-ring" });
    const plain = row(installed("Some Game"));
    expect(await resolveAddInput(plain, plain.name, search)).toEqual({ input: { name: "Some Game" }, gameId: null });
    expect(await resolveAddInput(null, "My Game", search)).toEqual({ input: { name: "My Game" }, gameId: null });
  });
});

describe("the highlight", () => {
  const items = { covers: ["a", "b", "c"], rows: ["d", "e"] };

  it("stays on the same game when the results change, and only falls back to the first item when it is gone", () => {
    expect(keepActive({ covers: [], rows: ["x", "e", "y"] }, "e")).toBe("e");
    expect(keepActive({ covers: [], rows: ["x", "y"] }, "e")).toBe("x");
    expect(keepActive(items, null)).toBe("a");
    expect(keepActive({ covers: [], rows: [] }, "e")).toBeNull();
  });

  it("moves along the covers with ← and →, down into the list and back up", () => {
    expect(stepActive(items, "a", "ArrowRight")).toBe("b");
    expect(stepActive(items, "c", "ArrowRight")).toBe("c");
    expect(stepActive(items, "a", "ArrowLeft")).toBe("a");
    expect(stepActive(items, "b", "ArrowDown")).toBe("d");
    expect(stepActive(items, "d", "ArrowDown")).toBe("e");
    expect(stepActive(items, "e", "ArrowDown")).toBe("e");
    expect(stepActive(items, "e", "ArrowUp")).toBe("d");
    expect(stepActive(items, "d", "ArrowUp")).toBe("a");
    expect(stepActive(items, "a", "ArrowUp")).toBe("a");
  });

  it("leaves ← and → to the search text in the list, and wraps the list around without covers", () => {
    expect(stepActive(items, "d", "ArrowLeft")).toBeUndefined();
    const list = { covers: [], rows: ["d", "e"] };
    expect(stepActive(list, "e", "ArrowDown")).toBe("d");
    expect(stepActive(list, "d", "ArrowUp")).toBe("e");
    expect(stepActive(list, "d", "Home")).toBeUndefined();
    expect(stepActive({ covers: [], rows: [] }, null, "ArrowDown")).toBeUndefined();
  });

  it("starts from the first item when the highlighted one is gone", () => {
    expect(stepActive({ covers: [], rows: ["d", "e"] }, "gone", "ArrowDown")).toBe("e");
  });
});

describe("modulesFor", () => {
  const all = [module("community.b", ["satisfactory"]), module("tavora.sat", ["satisfactory"], { official: true }), module("other", ["factorio"]), module("anywhere", [])];

  it("finds the modules made for a game, Tavora's own first", () => {
    expect(modulesFor(all, "satisfactory").map((item) => item.id)).toEqual(["tavora.sat", "community.b"]);
    expect(modulesFor(all, null)).toEqual([]);
    expect(modulesFor(all, "unknown")).toEqual([]);
  });

  it("adds only Tavora's own with the game", () => {
    expect(addedWithGame(modulesFor(all, "satisfactory"))).toEqual(["tavora.sat"]);
  });
});

describe("describeActivity", () => {
  it("says today, yesterday and days ago", () => {
    expect(describeActivity({ kind: "played", at: NOW - 60_000 }, NOW)).toEqual({ key: "addGame.played.today" });
    expect(describeActivity({ kind: "played", at: NOW - DAY }, NOW)).toEqual({ key: "addGame.played.yesterday" });
    expect(describeActivity({ kind: "played", at: NOW - 3 * DAY }, NOW)).toEqual({ key: "addGame.played.daysAgo", n: 3 });
    expect(describeActivity({ kind: "installed", at: NOW - DAY }, NOW)).toEqual({ key: "addGame.installed.yesterday" });
  });

  it("names the month for older dates, with the year only when it is another year", () => {
    const march = describeActivity({ kind: "played", at: new Date(2026, 2, 5).getTime() }, NOW);
    expect(march).toMatchObject({ key: "addGame.played.inMonth", withYear: false });
    const old = describeActivity({ kind: "installed", at: new Date(2025, 4, 5).getTime() }, NOW);
    expect(old).toMatchObject({ key: "addGame.installed.inMonth", withYear: true });
  });
});

describe("initials", () => {
  it("makes up to three letters from the words", () => {
    expect(initials("Path of Exile 2")).toBe("PE2");
    expect(initials("Hades")).toBe("HAD");
    expect(initials("")).toBe("?");
  });
});
