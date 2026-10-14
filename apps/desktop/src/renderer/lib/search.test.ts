import { describe, expect, it } from "vitest";
import { matchScore, queryWords, rank } from "./search";

describe("search", () => {
  it("needs every word, in the name or the extra text", () => {
    expect(matchScore(queryWords("path exile"), "Path of Exile 2")).not.toBeNull();
    expect(matchScore(queryWords("path diablo"), "Path of Exile 2")).toBeNull();
    expect(matchScore(queryWords("sorted"), "Game list order", ["How games are sorted"])).toBe(1);
  });

  it("ignores case and accents", () => {
    expect(matchScore(queryWords("POKEMON"), "Pokémon Legends")).not.toBeNull();
  });

  it("ranks name starts first and keeps order on ties", () => {
    const items = ["Hollow Knight", "Knight Online", "The Knightling", "Diablo IV"];
    expect(rank(items, "knight", (name) => ({ name }))).toEqual(["Knight Online", "Hollow Knight", "The Knightling"]);
    expect(rank(items, "", (name) => ({ name }))).toEqual(items);
  });
});
