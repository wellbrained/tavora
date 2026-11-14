import { afterEach, describe, expect, it } from "vitest";
import { setUiLanguage } from "../ui/text";
import { shortcutKeys } from "./Tooltip";

describe("shortcutKeys", () => {
  afterEach(() => setUiLanguage("en"));

  it("reads aria-keyshortcuts and plain text alike", () => {
    expect(shortcutKeys("Control+D")).toEqual(["Ctrl", "D"]);
    expect(shortcutKeys("Ctrl + d")).toEqual(["Ctrl", "D"]);
    expect(shortcutKeys("Alt+ArrowLeft")).toEqual(["Alt", "←"]);
    expect(shortcutKeys("Escape")).toEqual(["Esc"]);
  });

  it("shows the first of several alternatives", () => {
    expect(shortcutKeys("Control+1 Control+2")).toEqual(["Ctrl", "1"]);
  });

  it("names Ctrl in the language shown", () => {
    setUiLanguage("de");
    expect(shortcutKeys("Control+Shift+Tab")).toEqual(["Strg", "Shift", "Tab"]);
  });
});
