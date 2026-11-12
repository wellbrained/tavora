import { describe, expect, it } from "vitest";
import type { CatalogModuleView, InstalledGameView } from "../../shared/host-api";
import { addInputFor, buildRows, defaultTicks, describeActivity, initials, modulesFor } from "./game-picker";

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

  it("searches this PC, the built-in list and the online list, one row per game", () => {
    const rows = buildRows(pc, [{ id: "elden-ring", name: "Elden Ring" }, { id: "eldoran", name: "Eldoran" }], [{ id: "eldoran", name: "Eldoran", steamAppId: null }, { id: "eldevin", name: "Eldevin", steamAppId: null }], "eld");
    expect(rows.map((row) => row.name)).toEqual(["Elden Ring", "Eldevin", "Eldoran", "Zelda"]);
    expect(rows.find((row) => row.name === "Eldoran")?.online).toBeNull();
    expect(rows.find((row) => row.name === "Eldevin")?.online).not.toBeNull();
  });

  it("keeps a game the user has in its place, marked by its workspace", () => {
    const rows = buildRows([installed("Elden Ring", { catalogId: "elden-ring", workspaceId: "elden-ring" })], [], [], "");
    expect(rows[0]!.workspaceId).toBe("elden-ring");
  });
});

describe("a game on this PC that only the online search knows", () => {
  const nineKings = installed("9 Kings", { steamAppId: 2784470 });
  const online = [{ id: "9-kings", name: "9 Kings", steamAppId: 2784470 }];

  it("is one row, with the online game's id", () => {
    const rows = buildRows([nineKings], [], online, "9 king");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "9 Kings", gameId: "9-kings", installed: nineKings });
  });

  it("is added as the online game, as plain data", () => {
    const [row] = buildRows([nineKings], [], online, "9 king");
    const input = addInputFor(row!, "9 king");
    expect(input).toEqual({ online: { id: "9-kings", name: "9 Kings", steamAppId: 2784470 } });
    expect((input as { online: object }).online).not.toBe(online[0]);
  });

  it("stays a game added by name when the search doesn't know it", () => {
    const [row] = buildRows([nineKings], [], [], "9 king");
    expect(addInputFor(row!, "9 king")).toEqual({ name: "9 Kings" });
  });
});

describe("modulesFor", () => {
  const all = [module("community.b", ["satisfactory"]), module("tavora.sat", ["satisfactory"], { official: true }), module("other", ["factorio"]), module("anywhere", [])];

  it("finds the modules made for a game, Tavora's own first", () => {
    expect(modulesFor(all, "satisfactory").map((item) => item.id)).toEqual(["tavora.sat", "community.b"]);
    expect(modulesFor(all, null)).toEqual([]);
    expect(modulesFor(all, "unknown")).toEqual([]);
  });

  it("ticks only Tavora's own by default", () => {
    expect(defaultTicks(modulesFor(all, "satisfactory"))).toEqual(["tavora.sat"]);
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
