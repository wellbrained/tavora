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

  it("lets honest German and English text through when words only touch across a gap", () => {
    for (const text of [
      "Zu wenig Gameplay",
      "Der König gab mir ein Schwert",
      "Der Honig gab Kraft.",
      "Es war sonnig, gar nicht schlecht.",
      "Wenig Gas im Tank",
      "The flag got moved.",
      "Big game, small bugs.",
      "Fun game.Me too, I play it daily.",
      "Tolles Spiel.At least it runs.",
      "Works for the two of us.Us too.",
      "wenig",
      "König",
      "Das ist schön.Me too",
      "Mein Sofa got dirty",
      "Eine Uni gab Geld",
    ]) {
      expect(checkReviewText(text), text).toBe("ok");
    }
  });

  it("holds what may be an app address for a person, and never calls it a link outright", () => {
    for (const text of ["freerobux.App now", "Modul.App läuft", "Das Modul.App läuft gut", "schön.App ist das"]) {
      expect(checkReviewText(text), text).toBe("hold");
    }
    // A slur or a real link next to it still counts for what it is.
    expect(checkReviewText("Modul.App läuft, you faggot")).toBe("words");
    expect(checkReviewText("Modul.App läuft, see cheapgold.shop")).toBe("link");
    for (const text of ["freerobux.App", "freerobux.App/win now", "FreeRobux.App now", "free-robux.App now", "freerobux.app now"]) {
      expect(checkReviewText(text), text).toBe("link");
    }
  });

  it("reads doubled letters, digits and letters of other alphabets back", () => {
    for (const text of ["niigga", "faaggot", "ni99a", "ni66a", "nlgga", "nlgger", "nіgga", "fаggot", "ѕchwuchtel", "niigger", "niiggaa", "NIIGGA", "raape", "n 1 g g a", "n 1 9 9 a", "5lut", "r3tard", "k1ke", "f4ggot"]) {
      expect(checkReviewText(text), JSON.stringify(text)).toBe("words");
    }
  });

  it("keeps years and numbers as numbers, next to any short word", () => {
    for (const text of [
      "Released in 1994",
      "Released on 1994",
      "an 1994",
      "en 1994",
      "un 1994",
      "Uni 994",
      "Uni 1994",
      "in 1994er",
      "Released in1994",
      "on1994",
      "Das Spiel von 1996",
      "ni 1994",
      "in 99",
      "Uni 99",
      "Nintendo 64",
      "x64",
      "Win10 on 64 bit",
      "Version 9.9.4",
      "Top 10 in 2026",
      "Kapitel 9 an 6 Tagen",
      "1994",
      "99",
    ]) {
      expect(checkReviewText(text), text).toBe("ok");
      expect(checkModuleText(text), text).toBe("ok");
    }
  });

  it("never reads a year as a letter, right after or joined to a short word", () => {
    for (const word of ["in", "on", "an", "en", "un", "uni", "ani", "ini", "ni"]) {
      for (let year = 1900; year < 2100; year++) {
        expect(checkReviewText(`${word} ${year}`), `${word} ${year}`).toBe("ok");
        expect(checkReviewText(`${word}${year}`), `${word}${year}`).toBe("ok");
      }
    }
  });

  it("gets through long spaced-out text quickly", () => {
    expect(checkReviewText(`${"a ".repeat(10_000)}aa`)).toBe("ok");
    expect(checkReviewText(`a${" ".repeat(20_000)}aa`)).toBe("ok");
  });

  it("holds a possible address written with a full-width dot, and reads the rest as a link", () => {
    expect(checkReviewText("freerobux．App now")).toBe("hold");
    expect(checkReviewText("cheapgold．shop now")).toBe("link");
  });

  it("leaves honest words with doubled letters and other alphabets alone", () => {
    for (const text of [
      "wenig", "König", "Boot", "Kaffee", "Dinge", "Saal", "Minigame", "Rappe", "Die Rappen laufen", "Moor", "Haare", "Meer", "Waage", "Zoo", "good book", "cool", "seen", "Niigata",
      "Das Boot gab Kaffee", "Im Saal gab es Dinge", "Wenig Geld, viele Minigames",
      "Хорошая игра",
      "кот и сок",
      "Καλό παιχνίδι",
    ]) {
      expect(checkReviewText(text), text).toBe("ok");
    }
  });

  it("leaves two stray letters in front of a spread-out slur to reports", () => {
    expect(checkReviewText("xxnig ga")).toBe("ok");
  });

  it("still refuses a slur spread over words, in any spelling it caught before", () => {
    for (const text of ["nig ga", "ni gga", "n igga", "nigg a", "nig gas", "NIG-GA", "n1g g4", "ni g ga", "fag got", "schwuch tel", "juden sau", "you xnigga", "faggotry"]) {
      expect(checkReviewText(text), text).toBe("words");
    }
  });

  it("refuses a slur spread over words that starts one letter into the first", () => {
    for (const text of ["xnig ga", "xfa ggot", "xschwuch tel", "xjuden sau", "you xni gga"]) {
      expect(checkReviewText(text), text).toBe("words");
    }
  });

  it("reads an address as a link when only a line break follows it", () => {
    for (const text of ["evil.Me\nnow", "evil.Me\r\nnow", "evil.At\n\nnow", "evil.App\nnow"]) {
      // On one line it would go on as a sentence, or wait for a person.
      expect(checkReviewText(text), JSON.stringify(text)).toBe("link");
    }
  });

  it("still reads a real address as a link, whatever its case", () => {
    for (const text of [
      "visit cheapgold.me now",
      "cheapgold.Me",
      "cheapgold.Me/deal now",
      "CHEAPGOLD.ME now",
      "CheapGold.Me now",
      "buy at cheapgold.Shop now",
      "cheats.At",
      "Fun game.Me too, and see cheapgold.shop",
      "go to t.me/abc",
    ]) {
      expect(checkReviewText(text), text).toBe("link");
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
    for (const text of ["A timer for your runs. See https://example.org/help or mail me@example.org.", "Version 1.2.0: fixes the crash.", "Tracks your Sussex schedule", "Mach den Timer schneller.", "Zu wenig Gameplay", "Der König gab Gold."]) {
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
