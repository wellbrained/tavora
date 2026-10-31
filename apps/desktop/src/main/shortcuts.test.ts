import { describe, expect, it } from "vitest";
import { shortcutForKey } from "../shared/shortcut-keys";
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
    expect(shortcutFor(key({ key: "1" }))).toBe("workspace-1");
    expect(shortcutFor(key({ key: "9" }))).toBe("workspace-9");
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

describe("shortcutForKey (shared with the host page)", () => {
  const event = (over: object) => ({ type: "keyDown", key: "k", control: false, meta: false, alt: false, shift: false, ...over });

  it("uses Ctrl on Windows and Linux, and Cmd on macOS", () => {
    expect(shortcutForKey(event({ control: true }), false)).toBe("search");
    expect(shortcutForKey(event({ meta: true }), false)).toBeNull();
    expect(shortcutForKey(event({ meta: true }), true)).toBe("search");
    expect(shortcutForKey(event({ control: true }), true)).toBeNull();
  });

  it("ignores key releases and keys without the modifier", () => {
    expect(shortcutForKey(event({ control: true, type: "keyUp" }), false)).toBeNull();
    expect(shortcutForKey(event({}), false)).toBeNull();
  });

  it("steps through a panel's tabs with Ctrl+Tab and Ctrl+Shift+Tab, Ctrl on a Mac too", () => {
    for (const mac of [false, true]) {
      expect(shortcutForKey(event({ key: "Tab", control: true }), mac)).toBe("next-tab");
      expect(shortcutForKey(event({ key: "Tab", control: true, shift: true }), mac)).toBe("previous-tab");
    }
    expect(shortcutForKey(event({ key: "Tab" }), false)).toBeNull();
    expect(shortcutForKey(event({ key: "Tab", shift: true }), false)).toBeNull();
    expect(shortcutForKey(event({ key: "Tab", control: true, alt: true }), false)).toBeNull();
    expect(shortcutForKey(event({ key: "Tab", meta: true }), true)).toBeNull();
  });
});
