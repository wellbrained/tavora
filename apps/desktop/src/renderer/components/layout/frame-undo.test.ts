import { describe, expect, it } from "vitest";
import type { UndoOffer, UndoState } from "@tavora/official-ui/undoable";
import { createFrameUndos, type Removal } from "./frame-undo";

/** Offers that only note what happens to them. */
function setup() {
  const shown: { removal: Removal; state: UndoState }[] = [];
  const undos = createFrameUndos((removal) => {
    const entry: { removal: Removal; state: UndoState } = { removal, state: "open" };
    shown.push(entry);
    const offer: UndoOffer = {
      get state() {
        return entry.state;
      },
      undo: async () => (entry.state === "open" ? ((entry.state = "undone"), true) : false),
      commit: () => void (entry.state === "open" && (entry.state = "final")),
    };
    return offer;
  });
  return { shown, undos };
}

describe("frame undo toasts", () => {
  it("offers one toast per new removal, each on its own", () => {
    const { shown, undos } = setup();
    undos.sync([{ step: 1, count: 1 }]);
    undos.sync([
      { step: 1, count: 1 },
      { step: 4, count: 2 },
    ]);
    expect(shown.map((entry) => entry.removal)).toEqual([
      { step: 1, count: 1 },
      { step: 4, count: 2 },
    ]);
  });

  it("drops a toast quietly once its step was taken back on the page (Ctrl+Z), and leaves the others", () => {
    const { shown, undos } = setup();
    undos.sync([
      { step: 1, count: 1 },
      { step: 2, count: 1 },
    ]);
    undos.sync([{ step: 1, count: 1 }]);
    expect(shown.map((entry) => entry.state)).toEqual(["open", "final"]);
  });

  it("offers no new toast for a step that comes back by redo, or that was listed when the page opened", () => {
    const { shown, undos } = setup();
    undos.skip([{ step: 3, count: 1 }]);
    undos.sync([{ step: 3, count: 1 }]);
    expect(shown).toEqual([]);
    undos.sync([{ step: 5, count: 1 }]);
    undos.sync([]);
    undos.sync([{ step: 5, count: 1 }]);
    expect(shown).toHaveLength(1);
  });

  it("drops every toast when the page is left", () => {
    const { shown, undos } = setup();
    undos.sync([
      { step: 1, count: 1 },
      { step: 2, count: 1 },
    ]);
    undos.drop();
    expect(shown.map((entry) => entry.state)).toEqual(["final", "final"]);
  });
});
