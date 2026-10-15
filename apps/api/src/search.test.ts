import { beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { buildDataset, writeDatabase, type BuiltInGame, type WikidataGame } from "./dataset.ts";
import { searchGames } from "./search.ts";

const builtIns: BuiltInGame[] = [
  { id: "baldurs-gate-3", name: "Baldur's Gate 3", aliases: ["BG3"] },
  { id: "elden-ring", name: "Elden Ring" },
  { id: "hades-2", name: "Hades II" },
];

const wd = (qid: string, label: string, steamAppId: number | null, aliases: string[] = []): WikidataGame => ({
  qid,
  label,
  aliases,
  steamAppId,
});

let db: DatabaseSync;
beforeAll(() => {
  const games = buildDataset({
    builtIns,
    wikidata: [
      wd("Q1", "Elden Ring: Shadow of the Erdtree", 2778580),
      wd("Q2", "Hades", 1145360),
      wd("Q3", "Ringed Hollow", 11),
      wd("Q4", "Pokémon Scarlet", 12),
      wd("Q5", "Dark Ring of Elden Fire", 13),
    ],
    steam: [],
  });
  db = writeDatabase(":memory:", games);
});

const ids = (query: string, limit?: number) => searchGames(db, query, limit).map((game) => game.id);

describe("searchGames", () => {
  it("finds an exact name first, then longer names that start with it", () => {
    expect(ids("elden ring").slice(0, 2)).toEqual(["elden-ring", "elden-ring-shadow-of-the-erdtree"]);
  });

  it("finds a game by its alias", () => {
    expect(ids("bg3")).toEqual(["baldurs-gate-3"]);
  });

  it("puts an exact alias before a prefix of a name", () => {
    expect(ids("hades")[0]).toBe("hades");
  });

  it("ignores case, accents and apostrophes", () => {
    expect(ids("POKEMON scar")).toEqual(["pokemon-scarlet"]);
    expect(ids("baldurs gate")).toEqual(["baldurs-gate-3"]);
    expect(ids("Baldur's")).toEqual(["baldurs-gate-3"]);
  });

  it("matches words in any order, each as a word start", () => {
    expect(ids("ring eld")).toContain("elden-ring");
    expect(ids("ring eld")).toContain("dark-ring-of-elden-fire");
  });

  it("prefers built-in games and shorter names among equal matches", () => {
    const found = ids("ring");
    expect(found).toContain("elden-ring");
    expect(found.indexOf("elden-ring")).toBeLessThan(found.indexOf("elden-ring-shadow-of-the-erdtree"));
  });

  it("respects the limit and returns nothing for an empty or unknown query", () => {
    expect(ids("ring", 1)).toHaveLength(1);
    expect(ids("")).toEqual([]);
    expect(ids("   ")).toEqual([]);
    expect(ids("zzzzzz")).toEqual([]);
  });

  it("treats search syntax as plain text", () => {
    expect(() => ids('"* OR 1=1 --')).not.toThrow();
    expect(() => ids("elden AND NOT ring")).not.toThrow();
    expect(() => ids("near(a b)")).not.toThrow();
    expect(ids("'; drop table games; --")).toEqual([]);
  });

  it("returns the id, the name and the Steam appid, and nothing else", () => {
    expect(searchGames(db, "elden ring")[0]).toEqual({ id: "elden-ring", name: "Elden Ring", steamAppId: null });
    expect(searchGames(db, "hades")[0]).toEqual({ id: "hades", name: "Hades", steamAppId: 1145360 });
  });
});
