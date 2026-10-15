import { isGameId } from "@tavora/module-schema";
import { describe, expect, it } from "vitest";
import { isCanonicalId, normalize, slugify } from "./ids.ts";

describe("normalize", () => {
  it.each([
    ["Baldur's Gate 3", "baldurs gate 3"],
    ["Pokémon: Scarlet", "pokemon scarlet"],
    ["  Half--Life  2 ", "half life 2"],
    ["ELDEN RING", "elden ring"],
  ])("%s -> %s", (input, expected) => expect(normalize(input)).toBe(expected));
});

describe("slugify", () => {
  it.each([
    ["Elden Ring", "elden-ring"],
    ["Sid Meier's Civilization VI", "sid-meiers-civilization-vi"],
    ["Hades II", "hades-ii"],
    ["ARMA 3: Zeus!", "arma-3-zeus"],
  ])("%s -> %s", (input, expected) => expect(slugify(input)).toBe(expected));

  it("is empty when a name has no Latin letters or digits", () => expect(slugify("原神")).toBe(""));

  it("never starts with the custom game prefix", () => {
    expect(slugify("Local Co-op Party").startsWith("local-")).toBe(false);
    expect(isCanonicalId(slugify("Local Co-op Party"))).toBe(true);
  });

  it("stays within the id length limit", () => {
    const slug = slugify("a ".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(isCanonicalId(slug)).toBe(true);
  });
});

describe("isCanonicalId", () => {
  it("follows the same rule as module game ids, except for the local- prefix", () => {
    const samples = ["elden-ring", "poe2", "Elden", "-x", "a b", "", "x".repeat(64), "x".repeat(65), "local-hades-2", "localhost"];
    for (const sample of samples) {
      expect(isCanonicalId(sample)).toBe(isGameId(sample) && !sample.startsWith("local-"));
    }
  });
});
