import { describe, expect, it } from "vitest";
import { shortcutFor } from "./shortcuts";

const key = (overrides: Partial<Parameters<typeof shortcutFor>[0]>) => ({
  type: "keyDown",
  key: "k",
  control: process.platform !== "darwin",
  meta: process.platform === "darwin",
  alt: false,
  shift: false,
  ...overrides,
});

describe("shortcutFor", () => {
  it("opens search on Ctrl+K", () => {
    expect(shortcutFor(key({}))).toBe("search");
    expect(shortcutFor(key({ key: "K" }))).toBe("search");
  });

  it("knows the rest of Tavora's shortcuts", () => {
    expect(shortcutFor(key({ key: "/" }))).toBe("shortcuts");
    expect(shortcutFor(key({ key: "/", shift: true }))).toBe("shortcuts"); // German layout
    expect(shortcutFor(key({ key: "\\" }))).toBe("toggle-rail");
    expect(shortcutFor(key({ key: "\\", alt: true }))).toBe("toggle-rail"); // AltGr
    expect(shortcutFor(key({ key: "," }))).toBe("settings");
    expect(shortcutFor(key({ key: "h" }))).toBe("home");
    expect(shortcutFor(key({ key: "1" }))).toBe("game-1");
    expect(shortcutFor(key({ key: "9" }))).toBe("game-9");
  });

  it("leaves keys editors need alone", () => {
    expect(shortcutFor(key({ key: "b" }))).toBeNull();
    expect(shortcutFor(key({ key: "0" }))).toBeNull();
    expect(shortcutFor(key({ key: "1", shift: true }))).toBeNull();
  });

  it("ignores other keys, extra modifiers and key up", () => {
    expect(shortcutFor(key({ key: "j" }))).toBeNull();
    expect(shortcutFor(key({ shift: true }))).toBeNull();
    expect(shortcutFor(key({ alt: true }))).toBeNull();
    expect(shortcutFor(key({ type: "keyUp" }))).toBeNull();
    expect(shortcutFor(key({ control: false, meta: false }))).toBeNull();
  });
});
