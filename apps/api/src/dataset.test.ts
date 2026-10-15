import { describe, expect, it } from "vitest";
import { buildDataset, emptyRegistry, registryOf, type BuiltInGame, type SteamApp, type WikidataGame } from "./dataset.ts";

const builtIns: BuiltInGame[] = [
  { id: "elden-ring", name: "Elden Ring" },
  { id: "baldurs-gate-3", name: "Baldur's Gate 3", aliases: ["BG3"] },
];

const wd = (qid: string, label: string, steamAppId: number | null, aliases: string[] = []): WikidataGame => ({
  qid,
  label,
  aliases,
  steamAppId,
});

describe("buildDataset", () => {
  it("keeps the ids of built-in games and attaches keys found by name", () => {
    const games = buildDataset({
      builtIns,
      wikidata: [wd("Q1", "Elden Ring", 1245620, ["ER"])],
      steam: [],
    });
    const elden = games.find((game) => game.id === "elden-ring")!;
    expect(elden).toMatchObject({ steamAppId: 1245620, wikidata: "Q1", builtIn: true, aliases: ["ER"] });
    expect(games).toHaveLength(2);
  });

  it("issues a name slug to a new game", () => {
    const games = buildDataset({ builtIns: [], wikidata: [wd("Q2", "Hades II", 1145350)], steam: [] });
    expect(games[0]).toMatchObject({ id: "hades-ii", name: "Hades II", builtIn: false });
  });

  it("does not merge two different games with the same name", () => {
    const games = buildDataset({
      builtIns: [],
      wikidata: [wd("Q10", "Doom", 2280), wd("Q11", "Doom", 379720)],
      steam: [],
    });
    expect(games.map((game) => game.id).sort()).toEqual(["doom", "doom-379720"]);
  });

  it("gives the plain slug to the same game whatever the order of the sources", () => {
    const a = wd("Q10", "Doom", 2280);
    const b = wd("Q11", "Doom", 379720);
    const forward = buildDataset({ builtIns: [], wikidata: [a, b], steam: [] });
    const reverse = buildDataset({ builtIns: [], wikidata: [b, a], steam: [] });
    expect(forward).toEqual(reverse);
  });

  it("falls back to a key-based id when a name has no Latin letters", () => {
    const games = buildDataset({ builtIns: [], wikidata: [wd("Q3", "原神", 1971870)], steam: [] });
    expect(games[0]!.id).toBe("game-1971870");
  });

  it("never issues an id with the custom game prefix", () => {
    const games = buildDataset({ builtIns: [], wikidata: [wd("Q4", "Local Co-op Party", 5)], steam: [] });
    expect(games[0]!.id.startsWith("local-")).toBe(false);
  });

  it("refuses a built-in id that uses the custom game prefix or repeats", () => {
    expect(() => buildDataset({ builtIns: [{ id: "local-x", name: "X" }], wikidata: [], steam: [] })).toThrow(/valid canonical id/);
    expect(() =>
      buildDataset({ builtIns: [builtIns[0]!, builtIns[0]!], wikidata: [], steam: [] }),
    ).toThrow(/twice/);
  });

  it("adds Steam games that Wikidata lacks, and the Steam name as an alias", () => {
    const steam: SteamApp[] = [
      { appid: 1245620, name: "ELDEN RING" },
      { appid: 99, name: "Obscure Game" },
    ];
    const games = buildDataset({ builtIns, wikidata: [wd("Q1", "Elden Ring", 1245620)], steam });
    expect(games.find((game) => game.id === "obscure-game")).toMatchObject({ steamAppId: 99, wikidata: null });
    // "ELDEN RING" only differs by case, so it is not an alias.
    expect(games.find((game) => game.id === "elden-ring")!.aliases).toEqual([]);
  });

  it("limits aliases per game", () => {
    const aliases = Array.from({ length: 30 }, (_, index) => `alias ${index}`);
    const games = buildDataset({ builtIns: [], wikidata: [wd("Q5", "Many Names", 7, aliases)], steam: [] });
    expect(games[0]!.aliases).toHaveLength(10);
  });
});

describe("frozen ids", () => {
  it("a rebuild keeps every earlier id, even when a game is renamed or a same-named game appears", () => {
    const first = buildDataset({ builtIns: [], wikidata: [wd("Q10", "Hades", 1145360)], steam: [] });
    expect(first[0]!.id).toBe("hades");
    const registry = registryOf(first);

    const second = buildDataset({
      builtIns: [],
      // A new "Hades" with a lower item number would have taken the plain slug without the registry.
      wikidata: [wd("Q9", "Hades", 777), wd("Q10", "Hades (2020 video game)", 1145360)],
      steam: [],
      registry,
    });
    const old = second.find((game) => game.steamAppId === 1145360)!;
    expect(old).toMatchObject({ id: "hades", name: "Hades (2020 video game)" });
    expect(second.find((game) => game.steamAppId === 777)!.id).toBe("hades-777");
  });

  it("registry keeps ids of games that dropped out of the sources", () => {
    const first = buildDataset({ builtIns: [], wikidata: [wd("Q10", "Gone Game", 1)], steam: [] });
    const registry = registryOf(first);
    const second = buildDataset({ builtIns: [], wikidata: [wd("Q11", "Gone Game", 2)], steam: [], registry });
    expect(second[0]!.id).toBe("gone-game-2");
    expect(registryOf(second, registry).ids.has("gone-game")).toBe(true);
  });

  it("an empty registry is valid", () => {
    expect(registryOf([], emptyRegistry()).ids.size).toBe(0);
  });
});
