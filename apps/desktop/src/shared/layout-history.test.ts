import { describe, expect, it } from "vitest";
import { UndoHistory, type Change, type HistoryTarget } from "./layout-history";

/** A stand-in for the setups: per setup, item id to a number (its "state"). */
function world(start: Record<string, Record<string, number>> = {}) {
  const items: Record<string, Record<string, number>> = structuredClone(start);
  const writes: { setup: string; id: string; to: number | null }[] = [];
  const target: HistoryTarget<number> = {
    read: (setup, id) => items[setup]?.[id] ?? null,
    same: (a, b) => a === b,
    write: (setup, id, _from, to) => {
      writes.push({ setup, id, to });
      items[setup] ??= {};
      if (to === null) delete items[setup]![id];
      else items[setup]![id] = to;
      return true;
    },
  };
  return { items, writes, target };
}

const change = (id: string, before: number | null, after: number | null, setup = "s"): Change<number> => ({ setup, id, before, after });
const same = (a: number | null, b: number | null) => a === b;

describe("UndoHistory", () => {
  it("takes steps back in reverse order and does them again", () => {
    const { items, target } = world({ s: { a: 3 } });
    const history = new UndoHistory<number>();
    history.push([change("a", 1, 2)], same);
    history.push([change("a", 2, 3)], same);
    expect(history.undo(target)).toEqual([change("a", 2, 3)]);
    expect(items.s!.a).toBe(2);
    history.undo(target);
    expect(items.s!.a).toBe(1);
    expect(history.undo(target)).toBeNull();
    history.redo(target);
    history.redo(target);
    expect(items.s!.a).toBe(3);
    expect(history.redo(target)).toBeNull();
  });

  it("treats a step with many items as one, and takes a removal back with what it was", () => {
    const { items, target } = world({ s: {} });
    const history = new UndoHistory<number>();
    // Two frames removed at once.
    history.push([change("a", 5, null), change("b", 7, null)], same);
    history.undo(target);
    expect(items.s).toEqual({ a: 5, b: 7 });
    history.redo(target);
    expect(items.s).toEqual({});
  });

  it("takes an added item away and brings it back", () => {
    const { items, target } = world({ s: { a: 1 } });
    const history = new UndoHistory<number>();
    history.push([change("a", null, 1)], same);
    history.undo(target);
    expect(items.s).toEqual({});
    history.redo(target);
    expect(items.s).toEqual({ a: 1 });
  });

  it("undoes a step across two setups (Move to…)", () => {
    const { items, target } = world({ from: {}, to: { a: 4 } });
    const history = new UndoHistory<number>();
    history.push([change("a", 4, null, "from"), change("a", null, 4, "to")], same);
    history.undo(target);
    expect(items).toEqual({ from: { a: 4 }, to: {} });
  });

  it("keeps nothing for an action that changed nothing, and leaves out the items it did not change", () => {
    const history = new UndoHistory<number>();
    expect(history.push([change("a", 1, 1)], same)).toBe(false);
    expect(history.canUndo).toBe(false);
    history.push([change("a", 1, 1), change("b", 1, 2)], same);
    const { target, writes } = world({ s: { a: 1, b: 2 } });
    history.undo(target);
    expect(writes).toEqual([{ setup: "s", id: "b", to: 1 }]);
  });

  it("forgets what could be redone when something new is done", () => {
    const { target } = world({ s: { a: 2 } });
    const history = new UndoHistory<number>();
    history.push([change("a", 1, 2)], same);
    history.undo(target);
    expect(history.canRedo).toBe(true);
    history.push([change("a", 1, 5)], same);
    expect(history.canRedo).toBe(false);
    expect(history.canUndo).toBe(true);
  });

  it("does not put a step back over a change made since, and tries the one before it", () => {
    const { items, target } = world({ s: { a: 3, b: 9 } });
    const history = new UndoHistory<number>();
    history.push([change("b", 8, 9)], same);
    history.push([change("a", 2, 3)], same);
    // Moved in the game since.
    items.s!.a = 50;
    expect(history.undo(target)).toEqual([change("b", 8, 9)]);
    expect(items.s).toEqual({ a: 50, b: 8 });
    expect(history.canUndo).toBe(false);
  });

  it("drops a step with many items whole when one of them changed since", () => {
    const { items, target, writes } = world({ s: { a: 2, b: 2 } });
    const history = new UndoHistory<number>();
    history.push([change("a", 1, 2), change("b", 1, 2)], same);
    items.s!.b = 7;
    expect(history.undo(target)).toBeNull();
    expect(writes).toEqual([]);
  });

  it("keeps only the last steps up to its limit", () => {
    const history = new UndoHistory<number>(3);
    for (let i = 0; i < 5; i += 1) history.push([change("a", i, i + 1)], same);
    const { target } = world({ s: { a: 5 } });
    let count = 0;
    while (history.undo(target)) count += 1;
    expect(count).toBe(3);
  });

  it("forgets the steps of an item that went, in that setup only", () => {
    const history = new UndoHistory<number>();
    history.push([change("a", 1, 2, "x")], same);
    history.push([change("a", 1, 2, "y")], same);
    history.forget("x", "a");
    const { target } = world({ x: { a: 2 }, y: { a: 2 } });
    expect(history.undo(target)).toEqual([change("a", 1, 2, "y")]);
    expect(history.canUndo).toBe(false);
  });
});
