import { describe, expect, it } from "vitest";
import { parseLayoutMessage } from "./layout-view";
import { DEFAULT_BUTTONS, DEFAULT_TOOLBAR, disabled, normalizeButtons, normalizeToolbar, offered, selectionOf, toggleButton } from "./layout-toolbar";

describe("buttons", () => {
  it("start as the toolbar was before the menu", () => {
    expect(DEFAULT_TOOLBAR).toEqual({ show: true, buttons: ["settings", "hide", "reset", "reset-size", "remove"] });
    expect(normalizeToolbar(undefined)).toEqual(DEFAULT_TOOLBAR);
    expect(normalizeToolbar({ show: "no", buttons: "x" })).toEqual(DEFAULT_TOOLBAR);
  });
  it("keep known buttons once each, in the menu's order with Remove last", () => {
    expect(normalizeButtons(["remove", "lock", "lock", "nope", 4, "settings", "front"])).toEqual(["settings", "lock", "remove"]);
    expect(normalizeButtons("settings")).toBeNull();
  });
  it("are added and taken away", () => {
    expect(toggleButton(DEFAULT_BUTTONS, "lock")).toEqual(["settings", "lock", "hide", "reset", "reset-size", "remove"]);
    expect(toggleButton(DEFAULT_BUTTONS, "hide")).toEqual(["settings", "reset", "reset-size", "remove"]);
    expect(toggleButton(["arrange"], "arrange")).toEqual([]);
  });
  it("can be a submenu, which opens from its button", () => {
    expect(normalizeButtons(["align", "copy", "arrange"])).toEqual(["copy", "arrange", "align"]);
  });
  it("keep the toolbar off when it was turned off", () => {
    expect(normalizeToolbar({ show: false, buttons: ["lock"] })).toEqual({ show: false, buttons: ["lock"] });
  });
});

describe("what a selection allows", () => {
  const one = { locked: false, hiddenOnCanvas: false };
  it("offers Settings for one frame only", () => {
    expect(offered("settings", selectionOf([one]))).toBe(true);
    expect(offered("settings", selectionOf([one, one]))).toBe(false);
    expect(offered("lock", selectionOf([one, one]))).toBe(true);
  });
  it("switches off position and size actions only when every frame is locked", () => {
    const mixed = selectionOf([one, { ...one, locked: true }]);
    // A locked frame is skipped and the rest are acted on.
    for (const id of ["reset", "reset-size", "align", "align-left", "align-bottom", "front", "hide", "lock", "remove", "settings"] as const) expect(disabled(id, mixed)).toBe(false);
    const locked = selectionOf([{ ...one, locked: true }, { ...one, locked: true }]);
    for (const id of ["reset", "reset-size", "align", "align-left", "align-bottom"] as const) expect(disabled(id, locked)).toBe(true);
    for (const id of ["front", "hide", "lock", "remove"] as const) expect(disabled(id, locked)).toBe(false);
    expect(disabled("reset", selectionOf([one]))).toBe(false);
  });
});

describe("the messages", () => {
  it("arrange, align and lock name one or many frames", () => {
    expect(parseLayoutMessage({ type: "arrange", id: "a", to: "front" })).toEqual({ type: "arrange", id: "a", to: "front" });
    expect(parseLayoutMessage({ type: "arrange", ids: ["a", "b"], to: "back" })).toEqual({ type: "arrange", ids: ["a", "b"], to: "back" });
    expect(parseLayoutMessage({ type: "arrange", id: "a", to: "up" })).toBeNull();
    expect(parseLayoutMessage({ type: "align", ids: ["a"], edge: "middle" })).toEqual({ type: "align", ids: ["a"], edge: "middle" });
    expect(parseLayoutMessage({ type: "align", id: "a", edge: "diagonal" })).toBeNull();
    expect(parseLayoutMessage({ type: "lock", id: "a", locked: true })).toEqual({ type: "lock", id: "a", locked: true });
    expect(parseLayoutMessage({ type: "lock", id: "a" })).toBeNull();
  });
  it("toolbar carries show and/or buttons, and only known buttons", () => {
    expect(parseLayoutMessage({ type: "toolbar", show: false })).toEqual({ type: "toolbar", show: false });
    expect(parseLayoutMessage({ type: "toolbar", buttons: ["remove", "bogus", "lock"] })).toEqual({ type: "toolbar", buttons: ["lock", "remove"] });
    expect(parseLayoutMessage({ type: "toolbar" })).toBeNull();
    expect(parseLayoutMessage({ type: "toolbar", show: 1 })).toBeNull();
    expect(parseLayoutMessage({ type: "toolbar", buttons: "lock" })).toBeNull();
  });
});
