import { describe, expect, it } from "vitest";
import { PATTERNS, TONES, badgeLook } from "./badge";

describe("badgeLook", () => {
  it("is the same for the same id", () => {
    expect(badgeLook("elden-ring")).toEqual(badgeLook("elden-ring"));
  });

  it("keeps the tone existing workspaces already had", () => {
    // Same hash as before patterns existed: h = h * 31 + code, over the id.
    let hash = 0;
    for (const char of "local-hades-2") hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    expect(badgeLook("local-hades-2").color).toBe(TONES[hash % TONES.length]);
  });

  it("uses every tone and every pattern across a spread of ids", () => {
    const ids = Array.from({ length: 500 }, (_, index) => `game-${index}`);
    const looks = ids.map(badgeLook);
    expect(new Set(looks.map((look) => look.color)).size).toBe(TONES.length);
    expect(new Set(looks.map((look) => look.image)).size).toBe(PATTERNS.length);
  });

  it("rarely gives two different workspaces the same tone and pattern", () => {
    const ids = Array.from({ length: 40 }, (_, index) => `title-${index}`);
    const kinds = new Set(ids.map((id) => JSON.stringify(badgeLook(id))));
    // 64 combinations for 40 ids: plenty of distinct looks, a few repeats allowed.
    expect(kinds.size).toBeGreaterThanOrEqual(25);
  });
});
