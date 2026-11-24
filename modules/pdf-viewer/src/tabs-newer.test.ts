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
