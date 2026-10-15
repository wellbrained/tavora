import { describe, expect, it } from "vitest";
import { buildDataset, registryOf } from "./dataset.ts";
import { formatRegistry, parseRegistry } from "./registry-file.ts";

describe("registry file", () => {
  it("round-trips ids, including ids with no key or several keys", () => {
    const registry = {
      ids: new Set(["elden-ring", "hades", "no-key"]),
      keys: new Map([
        ["wd:Q1", "elden-ring"],
        ["steam:1245620", "elden-ring"],
        ["wd:Q10", "hades"],
      ]),
    };
    const parsed = parseRegistry(formatRegistry(registry));
    expect(parsed.ids).toEqual(registry.ids);
    expect(parsed.keys).toEqual(registry.keys);
  });

  it("is sorted and starts with a comment, so diffs stay small", () => {
    const text = formatRegistry({ ids: new Set(["b", "a"]), keys: new Map([["steam:2", "b"]]) });
    expect(text.split("\n").slice(1, 3)).toEqual(["a", "b\tsteam:2"]);
    expect(text.startsWith("#")).toBe(true);
  });

  it("keeps the ids of a finished build for the next one", () => {
    const games = buildDataset({
      builtIns: [],
      wikidata: [{ qid: "Q7", label: "Some Game", aliases: [], steamAppId: 70 }],
      steam: [],
    });
    const registry = parseRegistry(formatRegistry(registryOf(games)));
    const again = buildDataset({
      builtIns: [],
      wikidata: [{ qid: "Q7", label: "Some Game Renamed", aliases: [], steamAppId: 70 }],
      steam: [],
      registry,
    });
    expect(again[0]!.id).toBe("some-game");
  });
});
