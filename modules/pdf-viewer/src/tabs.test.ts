import { describe, expect, it } from "vitest";
import { closeTab, emptyTabs, followRenamed, keepExisting, openTab, parseTabState, reorderTabs } from "./tabs";

describe("parseTabState", () => {
  it("reads what was saved and repairs the rest", () => {
    expect(parseTabState({ tabs: ["a", "b", "a", 3, ""], active: "b" })).toEqual({ tabs: ["a", "b"], active: "b" });
    expect(parseTabState({ tabs: ["a", "b"], active: "zzz" })).toEqual({ tabs: ["a", "b"], active: "a" });
    for (const raw of [null, undefined, 5, "x", { tabs: "no" }]) expect(parseTabState(raw)).toEqual(emptyTabs());
  });
});

describe("opening and closing", () => {
  it("adds a tab once and shows it", () => {
    let state = openTab(emptyTabs(), "a");
    state = openTab(state, "b");
    state = openTab(state, "a");
    expect(state).toEqual({ tabs: ["a", "b"], active: "a" });
  });

  it("closing the shown tab shows its neighbour; closing another keeps the shown one", () => {
    const state = { tabs: ["a", "b", "c"], active: "b" };
    expect(closeTab(state, "b")).toEqual({ tabs: ["a", "c"], active: "c" });
    expect(closeTab({ tabs: ["a", "b"], active: "b" }, "b")).toEqual({ tabs: ["a"], active: "a" });
    expect(closeTab(state, "a")).toEqual({ tabs: ["b", "c"], active: "b" });
    expect(closeTab({ tabs: ["a"], active: "a" }, "a")).toEqual(emptyTabs());
    expect(closeTab(state, "zzz")).toBe(state);
  });
});

describe("keepExisting", () => {
  it("drops tabs of files that are gone and moves to a neighbour", () => {
    const state = { tabs: ["a", "b", "c"], active: "b" };
    expect(keepExisting(state, (id) => id !== "b")).toEqual({ tabs: ["a", "c"], active: "c" });
    expect(keepExisting(state, (id) => id === "a")).toEqual({ tabs: ["a"], active: "a" });
    expect(keepExisting(state, () => false)).toEqual(emptyTabs());
    expect(keepExisting(state, (id) => id !== "a")).toEqual({ tabs: ["b", "c"], active: "b" });
  });

  it("returns the same state when nothing changed", () => {
    const state = { tabs: ["a"], active: "a" };
    expect(keepExisting(state, () => true)).toBe(state);
  });
});

describe("reorderTabs", () => {
  it("follows the strip, ignores unknown ids and keeps tabs it left out", () => {
    const state = { tabs: ["a", "b", "c"], active: "a" };
    expect(reorderTabs(state, ["c", "a", "b"]).tabs).toEqual(["c", "a", "b"]);
    expect(reorderTabs(state, ["c", "x", "a"]).tabs).toEqual(["c", "a", "b"]);
  });
});

describe("followRenamed", () => {
  it("moves open and shown tabs to a file's new id, in place", () => {
    const state = { tabs: ["a", "b", "c"], active: "b" };
    expect(followRenamed(state, new Map([["b", "b2"]]))).toEqual({ tabs: ["a", "b2", "c"], active: "b2" });
    expect(followRenamed(state, new Map([["x", "y"]]))).toBe(state);
  });
});
