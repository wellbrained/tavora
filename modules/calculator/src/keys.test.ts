import { describe, expect, it } from "vitest";
import { EMPTY, press } from "./calc";
import { BASIC, keyAction, pasteKeys, PLUS } from "./keys";
import { de, en } from "./locales";

const plain = { ctrlKey: false, metaKey: false, altKey: false };
const pressed = (key: string, extra: Partial<typeof plain> = {}) => ({ key, ...plain, ...extra });

describe("key tables", () => {
  it("name every key that has no label of its own in both languages", () => {
    for (const key of [...BASIC, ...PLUS]) if (key.name) expect([de[key.name], en[key.name]].every(Boolean)).toBe(true);
  });

  it("have the keys the layouts promise", () => {
    expect(BASIC).toHaveLength(20);
    expect(PLUS).toHaveLength(28);
    expect(PLUS.map((key) => key.key)).toEqual(expect.arrayContaining(["sqrt", "square", "negate", "ans", "ceil", "k", "m", "b"]));
    expect(BASIC.map((key) => key.key)).not.toContain("sqrt");
  });
});

describe("keyAction", () => {
  it("types digits and signs, and maps the shortcuts", () => {
    expect(keyAction(pressed("7"))).toEqual({ type: "key", name: "7" });
    expect(keyAction(pressed("+"))).toEqual({ type: "key", name: "+" });
    expect(keyAction(pressed("Enter"))).toEqual({ type: "key", name: "=" });
    expect(keyAction(pressed("Escape"))).toEqual({ type: "key", name: "clear" });
    expect(keyAction(pressed("x"))).toEqual({ type: "key", name: "*" });
    expect(keyAction(pressed(","))).toEqual({ type: "key", name: "." });
    expect(keyAction(pressed("@"))).toEqual({ type: "key", name: "sqrt" });
    expect(keyAction(pressed("Q"))).toEqual({ type: "key", name: "square" });
    expect(keyAction(pressed("F9"))).toEqual({ type: "key", name: "negate" });
    expect(keyAction(pressed("K"))).toEqual({ type: "key", name: "k" });
  });

  it("ignores keys that mean nothing here", () => {
    expect(keyAction(pressed("a"))).toBeNull();
    expect(keyAction(pressed("Tab"))).toBeNull();
    expect(keyAction(pressed("5", { altKey: true }))).toBeNull();
    expect(keyAction(pressed("v", { ctrlKey: true }))).toBeNull();
  });

  it("copies on Ctrl+C unless text is selected", () => {
    expect(keyAction(pressed("c", { ctrlKey: true }))).toEqual({ type: "copy" });
    expect(keyAction(pressed("C", { metaKey: true }))).toEqual({ type: "copy" });
    expect(keyAction(pressed("c", { ctrlKey: true }), { selection: true })).toBeNull();
  });

  it("leaves Enter, Escape, Backspace and Delete to a focused control", () => {
    for (const key of ["Enter", "Escape", "Backspace", "Delete"]) expect(keyAction(pressed(key), { focusedControl: true })).toBeNull();
    expect(keyAction(pressed("7"), { focusedControl: true })).toEqual({ type: "key", name: "7" });
  });
});

describe("pasteKeys", () => {
  it("keeps what a sum is made of and drops the rest", () => {
    expect(pasteKeys("12 × (3 + 4)")).toEqual([..."12*(3+4)"]);
    expect(pasteKeys("10 ÷ 4 − 1")).toEqual([..."10/4-1"]);
    expect(pasteKeys("1,5K and 2M")).toEqual(["1", ".", "5", "k", "2", "m"]);
    expect(pasteKeys("hello")).toEqual([]);
  });

  it("types into an entry like the keypad does", () => {
    const entry = pasteKeys("2 × 3").reduce(press, EMPTY);
    expect(entry.text).toBe("2*3");
  });
});
