// A newer copy may keep more in the panel's state (the catalogue's, before a fallback to the shipped one): this
// version keeps it through a read, a tab change and the save.
import { expect, it } from "vitest";
import { closeTab, keepExisting, openTab, parseTabState, savedTabState } from "./tabs";

it("keeps a newer version's fields in the panel's tabs", () => {
  let state = parseTabState({ tabs: ["a", "b"], active: "a", split: true });
  state = openTab(state, "c");
  state = closeTab(state, "a");
  state = keepExisting(state, (id) => id !== "b");
  expect(savedTabState(state)).toEqual({ tabs: ["c"], active: "c", split: true });
});

it("keeps the tab of a file a newer version keeps, and never shows it", () => {
  const kept = (id: string) => id === "svg";
  const state = parseTabState({ tabs: ["a", "svg", "gone", "b"], active: "svg" });
  // The shown one is a file this version doesn't list: a neighbour is shown, the kept tab stays.
  const next = keepExisting(state, (id) => id === "a" || id === "b", kept);
  expect(next).toEqual({ tabs: ["a", "svg", "b"], active: "b" });
  expect(keepExisting(parseTabState({ tabs: ["svg"], active: "svg" }), () => false, kept)).toEqual({ tabs: ["svg"], active: null });
  // Without the kept check the tab goes (a file that is truly gone).
  expect(keepExisting(state, (id) => id === "a" || id === "b").tabs).toEqual(["a", "b"]);
});
