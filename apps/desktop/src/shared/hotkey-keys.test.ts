import { describe, expect, it } from "vitest";
import { hotkeyFromInput, hotkeyKeys, isHotkey } from "./hotkey-keys";

const press = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("hotkeyFromInput", () => {
  it.each([
    [press("KeyK", { ctrlKey: true, altKey: true }), "Ctrl+Alt+K"],
    [press("Digit1", { altKey: true, shiftKey: true }), "Alt+Shift+1"],
    [press("Numpad5"), "num5"],
    [press("NumpadAdd", { ctrlKey: true }), "Ctrl+numadd"],
    [press("F9"), "F9"],
    [press("F13", { shiftKey: true }), "Shift+F13"],
    [press("ArrowUp", { metaKey: true }), "Super+Up"],
    [press("Space", { ctrlKey: true, shiftKey: true }), "Ctrl+Shift+Space"],
  ])("takes %j as %s", (input, accelerator) => {
    expect(hotkeyFromInput(input)).toEqual({ accelerator });
  });

  it("goes by the key's place, not the letter a layout gives it", () => {
    // Z on a German keyboard sits where Y is on an English one; both report KeyY.
    expect(hotkeyFromInput(press("KeyY", { ctrlKey: true }))).toEqual({ accelerator: "Ctrl+Y" });
  });

  it.each([
    [press("KeyK"), "needs-modifier"],
    [press("KeyK", { shiftKey: true }), "needs-modifier"],
    [press("Digit3"), "needs-modifier"],
    [press("Space"), "needs-modifier"],
    [press("ControlLeft", { ctrlKey: true }), "modifier-only"],
    [press("ShiftRight", { shiftKey: true }), "modifier-only"],
    [press("Comma", { ctrlKey: true }), "unsupported"],
    [press("CapsLock"), "unsupported"],
  ])("refuses %j: %s", (input, problem) => {
    expect(hotkeyFromInput(input)).toEqual({ problem });
  });
});

describe("isHotkey", () => {
  it.each(["Ctrl+Alt+K", "num0", "F24", "Shift+F1", "Super+Home", "Ctrl+Alt+Shift+Super+Delete"])("takes %s", (value) => expect(isHotkey(value)).toBe(true));

  it.each(["K", "Shift+K", "Alt+Ctrl+K", "Ctrl+Ctrl+K", "Ctrl+", "Ctrl+Comma", "Ctrl+F25", "", 5, null, "Ctrl+Alt+K+L"])("refuses %j", (value) =>
    expect(isHotkey(value)).toBe(false),
  );
});

describe("hotkeyKeys", () => {
  it("names each key the way it is printed on the keyboard", () => {
    expect(hotkeyKeys("Ctrl+Alt+K")).toEqual(["Ctrl", "Alt", "K"]);
    expect(hotkeyKeys("Super+num5")).toEqual(["Win", "Num 5"]);
    expect(hotkeyKeys("Ctrl+numsub")).toEqual(["Ctrl", "Num −"]);
    expect(hotkeyKeys("Ctrl+Alt+K", true)).toEqual(["⌃", "⌥", "K"]);
  });
});
