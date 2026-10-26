import { describe, expect, it } from "vitest";
import { LAYOUT_ACTIONS, parseLayoutMessage, parseRect, requestForWindow } from "./layout-view";

describe("requestForWindow", () => {
  it("shows the hotkey dialog only in the window that asked", () => {
    const request = { id: 7, label: "x" };
    expect(requestForWindow(request, 7, "layout")).toBe(request);
    expect(requestForWindow(request, 7, "main")).toBeNull();
    expect(requestForWindow(request, null, "main")).toBe(request);
    expect(requestForWindow(request, null, "layout")).toBeNull();
    // A later request from a module is the main window's, whatever the layout asked before.
    expect(requestForWindow({ id: 8 }, 7, "main")).toEqual({ id: 8 });
    expect(requestForWindow({ id: 8 }, 7, "layout")).toBeNull();
    expect(requestForWindow(null, 7, "layout")).toBeNull();
  });
});

describe("parseRect", () => {
  it("takes plain numbers and nothing else", () => {
    expect(parseRect({ x: 1, y: 2, width: 3, height: 4 })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(parseRect({ x: "1", y: 2, width: 3, height: 4 })).toBeNull();
    expect(parseRect({ x: 1, y: 2, width: -3, height: 4 })).toBeNull();
    expect(parseRect({ x: Number.NaN, y: 2, width: 3, height: 4 })).toBeNull();
    expect(parseRect({ x: 1e9, y: 2, width: 3, height: 4 })).toBeNull();
    expect(parseRect(null)).toBeNull();
    expect(parseRect([1, 2, 3, 4])).toBeNull();
  });

  it("drops extra fields", () => {
    expect(parseRect({ x: 1, y: 2, width: 3, height: 4, evil: true })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});

describe("parseLayoutMessage", () => {
  it("takes the messages the pages send", () => {
    const rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(parseLayoutMessage({ type: "game", gameId: "poe2" })).toEqual({ type: "game", gameId: "poe2" });
    expect(parseLayoutMessage({ type: "grid", grid: "coarse" })).toEqual({ type: "grid", grid: "coarse" });
    expect(parseLayoutMessage({ type: "select", id: "a" })).toEqual({ type: "select", id: "a" });
    expect(parseLayoutMessage({ type: "select", id: null })).toEqual({ type: "select", id: null });
    expect(parseLayoutMessage({ type: "bounds", bounds: rect })).toEqual({ type: "bounds", bounds: rect });
    expect(parseLayoutMessage({ type: "bounds", bounds: null })).toEqual({ type: "bounds", bounds: null });
    expect(parseLayoutMessage({ type: "cover", covered: true })).toEqual({ type: "cover", covered: true });
    expect(parseLayoutMessage({ type: "drag", id: "a", rect })).toEqual({ type: "drag", id: "a", rect });
    expect(parseLayoutMessage({ type: "commit", id: "a", rect })).toEqual({ type: "commit", id: "a", rect });
    expect(parseLayoutMessage({ type: "canvas-hidden", id: "a", hidden: true })).toEqual({ type: "canvas-hidden", id: "a", hidden: true });
    expect(parseLayoutMessage({ type: "reset", id: "a" })).toEqual({ type: "reset", id: "a" });
    for (const type of ["undo", "redo", "drag-end", "take-picture", "choose-picture", "remove-picture", "dismiss-notice"]) expect(parseLayoutMessage({ type })).toEqual({ type });
  });

  it("refuses what is malformed, unknown or too big", () => {
    expect(parseLayoutMessage(null)).toBeNull();
    expect(parseLayoutMessage("undo")).toBeNull();
    expect(parseLayoutMessage({ type: "nope" })).toBeNull();
    expect(parseLayoutMessage({ type: "game", gameId: "" })).toBeNull();
    expect(parseLayoutMessage({ type: "game", gameId: "x".repeat(200) })).toBeNull();
    expect(parseLayoutMessage({ type: "grid", grid: "huge" })).toBeNull();
    expect(parseLayoutMessage({ type: "select", id: 3 })).toBeNull();
    expect(parseLayoutMessage({ type: "bounds", bounds: { x: 0 } })).toBeNull();
    expect(parseLayoutMessage({ type: "cover", covered: "yes" })).toBeNull();
    expect(parseLayoutMessage({ type: "drag", id: "a", rect: null })).toBeNull();
    expect(parseLayoutMessage({ type: "commit", id: "", rect: { x: 0, y: 0, width: 1, height: 1 } })).toBeNull();
    expect(parseLayoutMessage({ type: "canvas-hidden", id: "a", hidden: 1 })).toBeNull();
  });

  it("gives the window only the host actions it needs", () => {
    expect([...LAYOUT_ACTIONS].sort()).toEqual(["hotkey-answer", "preview-overlay", "remove-game-overlay", "set-game-overlay", "set-overlay-key", "set-panel-view", "stop-panel-in-game"]);
    // Nothing that reaches beyond overlays: no games, modules, files or settings.
    for (const action of LAYOUT_ACTIONS) expect(action).not.toMatch(/delete|install|add-|import|language|account|publish/);
  });
});
