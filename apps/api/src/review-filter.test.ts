import { describe, expect, it } from "vitest";
import { checkReviewText } from "./review-filter.ts";

describe("the review word filter", () => {
  it("lets honest reviews through, swearing included", () => {
    for (const text of [
      "Works great. At least on my PC.",
      "Shit, this saved my run!",
      "Scheiße, endlich ein guter Timer.",
      "Version 1.2.0 fixed the crash, e.g. on Linux.",
      "Snigger-worthy UI, but it works.",
      "Der Hurensohn-Boss ist jetzt leichter.",
    ]) {
      expect(checkReviewText(text), text).toBe("ok");
    }
  });

  it("refuses links and email addresses", () => {
    for (const text of ["see https://example.org", "www.cheats.ru", "join discord.gg/abc", "buy at cheapgold.shop", "mail me: x@y.de", "cheats (dot) com"]) {
      expect(checkReviewText(text), text).toBe("link");
    }
  });

  it("refuses slurs, also with letters swapped or spread out", () => {
    for (const text of ["you f4ggot", "you r e t a r d", "dev is a kanake", "Schwuchtel-Modul", "kys"]) {
      expect(checkReviewText(text), text).toBe("words");
    }
  });
});
