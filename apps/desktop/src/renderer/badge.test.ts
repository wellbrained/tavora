import { describe, expect, it } from "vitest";
import { LETTER, PATTERNS, TONES, badgeLook } from "./badge";

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

  it("keeps the letter readable on every tone, in light and dark themes alike", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((at) => {
        const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (const tone of TONES) expect((luminance(LETTER) + 0.05) / (luminance(tone) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
