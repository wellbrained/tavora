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

  it("ignores other keys, extra modifiers and key up", () => {
    expect(shortcutFor(key({ key: "j" }))).toBeNull();
    expect(shortcutFor(key({ shift: true }))).toBeNull();
    expect(shortcutFor(key({ alt: true }))).toBeNull();
    expect(shortcutFor(key({ type: "keyUp" }))).toBeNull();
    expect(shortcutFor(key({ control: false, meta: false }))).toBeNull();
  });
});
