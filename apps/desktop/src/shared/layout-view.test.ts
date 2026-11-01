import { describe, expect, it } from "vitest";
import { parseLayoutMessage, parseRect } from "./layout-view";

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
    expect(parseLayoutMessage({ type: "copy-setup", to: "valheim", mode: "add" })).toEqual({ type: "copy-setup", to: "valheim", mode: "add" });
    expect(parseLayoutMessage({ type: "copy-setup", to: "valheim", mode: "replace", extra: 1 })).toEqual({ type: "copy-setup", to: "valheim", mode: "replace" });
    expect(parseLayoutMessage({ type: "select", id: "a" })).toEqual({ type: "select", id: "a" });
    expect(parseLayoutMessage({ type: "select", id: null })).toEqual({ type: "select", id: null });
    expect(parseLayoutMessage({ type: "bounds", bounds: rect })).toEqual({ type: "bounds", bounds: rect });
    expect(parseLayoutMessage({ type: "bounds", bounds: null })).toEqual({ type: "bounds", bounds: null });
    expect(parseLayoutMessage({ type: "cover", covered: true })).toEqual({ type: "cover", covered: true });
    expect(parseLayoutMessage({ type: "drag", id: "a", rect })).toEqual({ type: "drag", id: "a", rect });
    expect(parseLayoutMessage({ type: "commit", id: "a", rect })).toEqual({ type: "commit", id: "a", rect });
    expect(parseLayoutMessage({ type: "canvas-hidden", id: "a", hidden: true })).toEqual({ type: "canvas-hidden", id: "a", hidden: true });
    expect(parseLayoutMessage({ type: "reset", id: "a" })).toEqual({ type: "reset", id: "a" });
    expect(parseLayoutMessage({ type: "reset-size", id: "a" })).toEqual({ type: "reset-size", id: "a" });
    expect(parseLayoutMessage({ type: "remove", id: "a" })).toEqual({ type: "remove", id: "a" });
    expect(parseLayoutMessage({ type: "settings", id: "a" })).toEqual({ type: "settings", id: "a" });
    expect(parseLayoutMessage({ type: "remove", id: "" })).toBeNull();
    expect(parseLayoutMessage({ type: "select", ids: ["a", "b", "a"] })).toEqual({ type: "select", ids: ["a", "b"] });
    expect(parseLayoutMessage({ type: "select", ids: [] })).toEqual({ type: "select", ids: [] });
    expect(parseLayoutMessage({ type: "commit", items: [{ id: "a", rect }, { id: "b", rect }] })).toEqual({ type: "commit", items: [{ id: "a", rect }, { id: "b", rect }] });
    expect(parseLayoutMessage({ type: "drag", items: [{ id: "a", rect }] })).toEqual({ type: "drag", items: [{ id: "a", rect }] });
    expect(parseLayoutMessage({ type: "remove", ids: ["a", "b"] })).toEqual({ type: "remove", ids: ["a", "b"] });
    expect(parseLayoutMessage({ type: "canvas-hidden", ids: ["a"], hidden: false })).toEqual({ type: "canvas-hidden", ids: ["a"], hidden: false });
    expect(parseLayoutMessage({ type: "change", ids: ["a"], change: { opacity: 50, extra: 1 } })).toEqual({ type: "change", ids: ["a"], change: { opacity: 50 } });
    expect(parseLayoutMessage({ type: "remove", ids: [] })).toBeNull();
    expect(parseLayoutMessage({ type: "select", ids: [3] })).toBeNull();
    expect(parseLayoutMessage({ type: "commit", items: [] })).toBeNull();
    expect(parseLayoutMessage({ type: "commit", items: [{ id: "a", rect: null }] })).toBeNull();
    expect(parseLayoutMessage({ type: "change", ids: ["a"], change: { opacity: 60 } })).toBeNull();
    expect(parseLayoutMessage({ type: "change", ids: ["a"], change: {} })).toBeNull();
    expect(parseLayoutMessage({ type: "select", ids: Array.from({ length: 65 }, (_, i) => `i${i}`) })).toBeNull();
    expect(parseLayoutMessage({ type: "preview", choice: "21:9" })).toEqual({ type: "preview", choice: "21:9" });
    expect(parseLayoutMessage({ type: "preview", choice: "" })).toBeNull();
    expect(parseLayoutMessage({ type: "preview", choice: 3 })).toBeNull();
    for (const type of ["undo", "redo", "drag-end", "take-picture", "choose-picture", "remove-picture", "dismiss-notice", "done"]) expect(parseLayoutMessage({ type })).toEqual({ type });
    // Gone with per-game positions: each setup has its own.
    for (const type of ["customize", "follow-all", "follow-item"]) expect(parseLayoutMessage({ type, id: "a" })).toBeNull();
  });

  it("refuses what is malformed, unknown or too big", () => {
    expect(parseLayoutMessage(null)).toBeNull();
    expect(parseLayoutMessage("undo")).toBeNull();
    expect(parseLayoutMessage({ type: "nope" })).toBeNull();
    expect(parseLayoutMessage({ type: "game", gameId: "" })).toBeNull();
    expect(parseLayoutMessage({ type: "game", gameId: "x".repeat(200) })).toBeNull();
    expect(parseLayoutMessage({ type: "grid", grid: "huge" })).toBeNull();
    expect(parseLayoutMessage({ type: "copy-setup", to: "valheim", mode: "merge" })).toBeNull();
    expect(parseLayoutMessage({ type: "copy-setup", to: "", mode: "add" })).toBeNull();
    expect(parseLayoutMessage({ type: "copy-setup", mode: "add" })).toBeNull();
    expect(parseLayoutMessage({ type: "select", id: 3 })).toBeNull();
    expect(parseLayoutMessage({ type: "bounds", bounds: { x: 0 } })).toBeNull();
    expect(parseLayoutMessage({ type: "cover", covered: "yes" })).toBeNull();
    expect(parseLayoutMessage({ type: "drag", id: "a", rect: null })).toBeNull();
    expect(parseLayoutMessage({ type: "commit", id: "", rect: { x: 0, y: 0, width: 1, height: 1 } })).toBeNull();
    expect(parseLayoutMessage({ type: "canvas-hidden", id: "a", hidden: 1 })).toBeNull();
    expect(parseLayoutMessage({ type: "reset-size", id: "" })).toBeNull();
  });

  it("takes the messages of the page's lists", () => {
    expect(parseLayoutMessage({ type: "add-source", id: "p1" })).toEqual({ type: "add-source", id: "p1" });
    expect(parseLayoutMessage({ type: "add-source", id: "p1", key: "d-1" })).toEqual({ type: "add-source", id: "p1", key: "d-1" });
    expect(parseLayoutMessage({ type: "add-source", id: "p1", key: "" })).toBeNull();
    expect(parseLayoutMessage({ type: "add-source", id: "p1", key: 3 })).toBeNull();
    expect(parseLayoutMessage({ type: "move", id: "panel\np1", to: "$all" })).toEqual({ type: "move", id: "panel\np1", to: "$all" });
    expect(parseLayoutMessage({ type: "move", id: "panel\np1" })).toBeNull();
    // Adding a game's setup is only on the rail, never a message of the page.
    expect(parseLayoutMessage({ type: "add-setup", gameId: "poe2" })).toBeNull();
    expect(parseLayoutMessage({ type: "add-source", id: 3 })).toBeNull();
    expect(parseLayoutMessage({ type: "move" })).toBeNull();
  });
});
