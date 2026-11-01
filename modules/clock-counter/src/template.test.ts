import { describe, expect, it } from "vitest";
import { camelName, cleanName, compile, defaultText, display, keys, render, tokenize, type Member } from "./template";

const members: Member[] = [
  { id: "d", name: "Deaths" },
  { id: "s", name: "Sit-ups" },
];

describe("camelName and keys", () => {
  it("writes a name as one camelCase word", () => {
    expect(camelName("Counter 2")).toBe("counter2");
    expect(camelName("Boss kills")).toBe("bossKills");
    expect(camelName("Sit-ups")).toBe("sitUps");
    expect(camelName("Deaths")).toBe("deaths");
    expect(camelName("HP left")).toBe("hpLeft");
    expect(camelName("bossKills")).toBe("bossKills");
  });

  it("keeps umlauts and other letters, and drops the rest", () => {
    expect(camelName("Tode")).toBe("tode");
    expect(camelName("Größe")).toBe("größe");
    expect(camelName("Äpfel essen")).toBe("äpfelEssen");
    expect(camelName("Тест счёт")).toBe("тестСчёт");
    expect(camelName("💀 Deaths!! (total)")).toBe("deathsTotal");
    expect(camelName("a{b}c")).toBe("aBC");
  });

  it("falls back to counter when nothing is left", () => {
    expect(camelName("")).toBe("counter");
    expect(camelName("💀 --")).toBe("counter");
  });

  it("numbers keys that come out the same, in list order", () => {
    const same: Member[] = [
      { id: "a", name: "Sit-ups" },
      { id: "b", name: "Sit ups" },
      { id: "c", name: "SIT UPS" },
    ];
    expect([...keys(same).values()]).toEqual(["sitUps", "sitUps2", "sitUps3"]);
  });

  it("doesn't hand a number to a key another counter already has", () => {
    const crowded: Member[] = [
      { id: "a", name: "Kills" },
      { id: "b", name: "kills" },
      { id: "c", name: "Kills 2" },
      { id: "d", name: "!!!" },
      { id: "e", name: "" },
    ];
    expect([...keys(crowded).values()]).toEqual(["kills", "kills3", "kills2", "counter", "counter2"]);
  });
});

describe("tokenize", () => {
  it("splits plain text and {references}", () => {
    expect(tokenize("{Deaths} Death – {Sit-ups} Situps 💀")).toEqual({
      parts: [{ ref: "Deaths" }, { text: " Death – " }, { ref: "Sit-ups" }, { text: " Situps 💀" }],
    });
  });

  it("reads doubled braces as the brace itself", () => {
    expect(tokenize("a {{b}} {Deaths}")).toEqual({ parts: [{ text: "a {b} " }, { ref: "Deaths" }] });
  });

  it("fails on an unclosed or lone brace", () => {
    expect(tokenize("{Deaths")).toEqual({ error: "unclosed" });
    expect(tokenize("{Deaths {Sit-ups}")).toEqual({ error: "unclosed" });
    expect(tokenize("Deaths}")).toEqual({ error: "stray" });
  });
});

describe("compile", () => {
  it("saves counter ids instead of names", () => {
    expect(compile("{Deaths} Death – {Sit-ups} Situps", members)).toEqual({ ok: true, stored: "{@d} Death – {@s} Situps" });
  });

  it("finds a key whatever its case or spacing", () => {
    expect(compile("{ deaths }", members)).toEqual({ ok: true, stored: "{@d}" });
    expect(compile("{SITUPS}", members)).toEqual({ ok: true, stored: "{@s}" });
  });

  it("reads camelCase keys: {counter2}, {bossKills}, {sitUps}", () => {
    const named: Member[] = [
      { id: "a", name: "Counter" },
      { id: "b", name: "Counter 2" },
      { id: "c", name: "Boss kills" },
      { id: "d", name: "Sit-ups" },
    ];
    expect(compile("{counter2} Deaths – {counter} Situps {bossKills} {sitUps}", named)).toEqual({ ok: true, stored: "{@b} Deaths – {@a} Situps {@c} {@d}" });
  });

  it("tells counters with the same key apart by their number", () => {
    const same: Member[] = [
      { id: "a", name: "Sit-ups" },
      { id: "b", name: "Sit ups" },
    ];
    expect(compile("{sitUps} {sitUps2}", same)).toEqual({ ok: true, stored: "{@a} {@b}" });
  });

  it("finds umlaut keys", () => {
    const umlauts: Member[] = [
      { id: "t", name: "Tode" },
      { id: "g", name: "Größe" },
    ];
    expect(compile("{tode} {größe}", umlauts)).toEqual({ ok: true, stored: "{@t} {@g}" });
    expect(compile("{Tode} {GRÖßE}", umlauts)).toEqual({ ok: true, stored: "{@t} {@g}" });
  });

  it("still reads lines written with the full name, spaces included, in any case", () => {
    const named: Member[] = [
      { id: "a", name: "Counter" },
      { id: "b", name: "Counter 2" },
      { id: "c", name: "Boss kills" },
    ];
    expect(compile("{Counter 2} Deaths – {Counter} Situps", named)).toEqual({ ok: true, stored: "{@b} Deaths – {@a} Situps" });
    expect(compile("{boss KILLS}", named)).toEqual({ ok: true, stored: "{@c}" });
    expect(compile("{ Sit-ups }", [{ id: "s", name: "Sit-ups" }])).toEqual({ ok: true, stored: "{@s}" });
  });

  it("finds the counter the field shows when a key is also another counter's name", () => {
    const tricky: Member[] = [
      { id: "a", name: "Foo bar" },
      { id: "b", name: "foobar" },
    ];
    const shown = display("{@a} {@b}", tricky);
    expect(shown).toBe("{fooBar} {foobar2}");
    expect(compile(shown, tricky)).toEqual({ ok: true, stored: "{@a} {@b}" });
  });

  it("rejects an empty text, an unknown counter and a broken brace", () => {
    expect(compile("   ", members)).toMatchObject({ ok: false, error: "empty" });
    expect(compile("{Kills} here", members)).toMatchObject({ ok: false, error: "unknown", name: "Kills" });
    expect(compile("{sit ups}", members)).toMatchObject({ ok: false, error: "unknown", name: "sit ups" });
    expect(compile("{}", members)).toMatchObject({ ok: false, error: "unknown" });
    expect(compile("{Deaths", members)).toMatchObject({ ok: false, error: "unclosed" });
    expect(compile("Deaths}", members)).toMatchObject({ ok: false, error: "stray" });
  });

  it("allows text with no counter in it, and keeps literal braces", () => {
    expect(compile("Hello", members)).toEqual({ ok: true, stored: "Hello" });
    const braces = compile("{{x}} {Deaths}", members);
    expect(braces).toEqual({ ok: true, stored: "{{x}} {@d}" });
  });
});

describe("display and render", () => {
  it("shows keys for ids, and follows a rename", () => {
    const stored = "{@d} Death – {@s} Situps";
    expect(display(stored, members)).toBe("{deaths} Death – {sitUps} Situps");
    expect(display(stored, [{ id: "d", name: "Boss kills" }, members[1]!])).toBe("{bossKills} Death – {sitUps} Situps");
  });

  it("shows the same saved text with the new key after a rename", () => {
    const before: Member[] = [{ id: "a", name: "Counter" }, { id: "b", name: "Counter 2" }];
    const typed = compile("{counter2} Deaths – {counter} Situps", before);
    if (!typed.ok) throw new Error("should compile");
    const after: Member[] = [{ id: "a", name: "Situps" }, { id: "b", name: "Tode" }];
    expect(display(typed.stored, after)).toBe("{tode} Deaths – {situps} Situps");
    expect(typed.stored).toBe("{@b} Deaths – {@a} Situps");
  });

  it("numbers a key in the field when two counters share it", () => {
    const same: Member[] = [{ id: "a", name: "Sit-ups" }, { id: "b", name: "Sit ups" }];
    expect(display("{@a} {@b}", same)).toBe("{sitUps} {sitUps2}");
  });

  it("turns a line written with names into the form with keys", () => {
    const old = compile("{Deaths} Death – {Sit-ups} Situps", members);
    expect(old.ok && display(old.stored, members)).toBe("{deaths} Death – {sitUps} Situps");
  });

  it("round-trips through the field", () => {
    const result = compile("{{x}} {deaths}!", members);
    expect(result.ok && display(result.stored, members)).toBe("{{x}} {deaths}!");
  });

  it("shows {?} for a counter that is gone", () => {
    expect(display("{@gone} x", members)).toBe("{?} x");
  });

  it("renders the values in, 1 Death – 5 Situps 💀", () => {
    const values = new Map([["d", "1"], ["s", "5"]]);
    expect(render("{@d} Death – {@s} Situps 💀", values)).toBe("1 Death – 5 Situps 💀");
    expect(render("{{x}} {@d}", values)).toBe("{x} 1");
  });

  it("renders nothing for text it can't use", () => {
    const values = new Map([["d", "1"]]);
    expect(render("{@gone}", values)).toBeNull();
    expect(render("{@d", values)).toBeNull();
    expect(render("", values)).toBeNull();
  });
});

describe("defaultText", () => {
  it("names each counter: {deaths} Deaths – {sitUps} Sit-ups", () => {
    expect(defaultText(members)).toBe("{deaths} Deaths – {sitUps} Sit-ups");
    const result = compile(defaultText(members), members);
    expect(result).toEqual({ ok: true, stored: "{@d} Deaths – {@s} Sit-ups" });
  });

  it("leaves braces out of names", () => {
    expect(cleanName(" a{b}c ")).toBe("abc");
  });
});
