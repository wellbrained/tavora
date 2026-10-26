import { describe, expect, it } from "vitest";
import { checkModuleText, checkReviewText } from "./review-filter.ts";

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

describe("the module text filter", () => {
  it("lets honest texts through, links included", () => {
    for (const text of ["A timer for your runs. See https://example.org/help or mail me@example.org.", "Version 1.2.0: fixes the crash.", "Tracks your Sussex schedule", "Mach den Timer schneller."]) {
      expect(checkModuleText(text), text).toBe("ok");
    }
  });

  it("flags slurs and adult terms, also spread out or with swapped letters", () => {
    expect(checkModuleText("dev is a kanake")).toBe("words");
    expect(checkModuleText("Best p0rn browser")).toBe("adult");
    expect(checkModuleText("N S F W mods")).toBe("adult");
    expect(checkModuleText("Hentai nude patch")).toBe("adult");
    for (const text of ["For 18+ only", "Ab 18", "+18 content", "XXX pack", "R18 mod", "Erotik-Modul"]) expect(checkModuleText(text), text).toBe("adult");
  });
});
