import { describe, expect, it } from "vitest";
import { cleanName, compile, defaultText, display, render, tokenize, type Member } from "./template";

const members: Member[] = [
  { id: "d", name: "Deaths" },
  { id: "s", name: "Sit-ups" },
];

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

  it("finds a name whatever its case or spacing", () => {
    expect(compile("{ deaths }", members)).toEqual({ ok: true, stored: "{@d}" });
  });

  it("rejects an empty text, an unknown counter and a broken brace", () => {
    expect(compile("   ", members)).toMatchObject({ ok: false, error: "empty" });
    expect(compile("{Kills} here", members)).toMatchObject({ ok: false, error: "unknown", name: "Kills" });
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
  it("shows names for ids, and follows a rename", () => {
    const stored = "{@d} Death – {@s} Situps";
    expect(display(stored, members)).toBe("{Deaths} Death – {Sit-ups} Situps");
    expect(display(stored, [{ id: "d", name: "Kills" }, members[1]!])).toBe("{Kills} Death – {Sit-ups} Situps");
  });

  it("round-trips through the field", () => {
    const result = compile("{{x}} {Deaths}!", members);
    expect(result.ok && display(result.stored, members)).toBe("{{x}} {Deaths}!");
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
  it("names each counter: {Deaths} Deaths – {Sit-ups} Sit-ups", () => {
    expect(defaultText(members)).toBe("{Deaths} Deaths – {Sit-ups} Sit-ups");
    const result = compile(defaultText(members), members);
    expect(result).toEqual({ ok: true, stored: "{@d} Deaths – {@s} Sit-ups" });
  });

  it("leaves braces out of names", () => {
    expect(cleanName(" a{b}c ")).toBe("abc");
  });
});
