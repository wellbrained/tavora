import { describe, expect, it } from "vitest";
import { matchScore, nameScore, queryWords, rank, rankByName, startsOrIsWord } from "./search";

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

describe("game names", () => {
  it("scores exact, start, whole word, word start, inside, nothing", () => {
    expect(nameScore("rust", "Rust")).toBe(5);
    expect(nameScore("eld", "Elden Ring")).toBe(4);
    expect(nameScore("theme", "Theme Park Studio")).toBe(4);
    expect(nameScore("park", "Theme Park Studio")).toBe(3);
    expect(nameScore("eld", "The Elder Scrolls V: Skyrim")).toBe(2);
    expect(nameScore("eld", "Battlefield 6")).toBe(1);
    expect(nameScore("eld", "Rust")).toBe(0);
    expect(nameScore("", "Rust")).toBe(0);
  });

  it("reads punctuation and accents loosely", () => {
    expect(nameScore("counter strike", "Counter-Strike 2")).toBe(4);
    expect(nameScore("Counter-Strike 2", "counter strike 2")).toBe(5);
    expect(nameScore("pokemon", "Pokémon Legends")).toBe(4);
  });

  it("suggests only names the text starts or is a word of", () => {
    expect(startsOrIsWord("theme", "TheMemory")).toBe(true);
    expect(startsOrIsWord("theme", "Theme Park Studio")).toBe(true);
    expect(startsOrIsWord("eld", "The Elder Scrolls V: Skyrim")).toBe(false);
    expect(startsOrIsWord("eld", "Battlefield 6")).toBe(false);
  });

  it("ranks real starts above names that merely contain the text, ties by name", () => {
    const names = ["Battlefield 6", "Starfield", "The Elder Scrolls V: Skyrim", "Eldoran", "Eldevin", "Eldgear", "Elden Ring"];
    expect(rankByName(names, "eld", (name) => name)).toEqual([
      "Elden Ring",
      "Eldevin",
      "Eldgear",
      "Eldoran",
      "The Elder Scrolls V: Skyrim",
      "Battlefield 6",
      "Starfield",
    ]);
    // Without text everything is a tie: by name, nothing dropped.
    expect(rankByName(["Counter-Strike 2", "Sid Meier's Civilization VI", "Battlefield 6"], "", (name) => name)).toEqual([
      "Battlefield 6",
      "Counter-Strike 2",
      "Sid Meier's Civilization VI",
    ]);
  });
});
