import { describe, expect, it } from "vitest";
import { LayoutHistory, type Part } from "./layout-history";

/** Setups as plain maps of item id to a number; `room`: how many items a setup may hold. */
function world(start: Record<string, Record<string, number>>, room = 10) {
  const setups = new Map(Object.entries(start).map(([id, items]) => [id, new Map(Object.entries(items))]));
  const writes: string[] = [];
  const history = new LayoutHistory<number>({
    read: (setupId, id) => setups.get(setupId)?.get(id) ?? null,
    write: (part, to) => {
      const items = setups.get(part.setupId)!;
      if (to === null) items.delete(part.id);
      else if (!items.has(part.id) && items.size >= room) return false;
      else items.set(part.id, to);
      writes.push(`${part.setupId}.${part.id}=${to}`);
      return true;
    },
    same: (a, b) => a === b,
  });
  const read = (setupId: string) => Object.fromEntries(setups.get(setupId)!);
  /** Does something and keeps it as one step, the way the layout does: read before, change, read after. */
  const act = (targets: [string, string][], change: () => void) => {
    const before = targets.map(([setupId, id]) => setups.get(setupId)!.get(id) ?? null);
    change();
    return history.record(targets.map(([setupId, id], index): Part<number> => ({ setupId, id, before: before[index]!, after: setups.get(setupId)!.get(id) ?? null })));
  };
  return { setups, history, read, act, writes };
}

describe("LayoutHistory", () => {
  it("takes a step of many items back as one, and does it again", () => {
    const { setups, history, read, act } = world({ s: { a: 1, b: 2, c: 3 } });
    act([["s", "a"], ["s", "b"]], () => {
      setups.get("s")!.set("a", 10);
      setups.get("s")!.set("b", 20);
    });
    expect(history.canUndo).toBe(true);
    expect(history.undo()?.parts).toHaveLength(2);
    expect(read("s")).toEqual({ a: 1, b: 2, c: 3 });
    expect(history).toMatchObject({ canUndo: false, canRedo: true });
    history.redo();
    expect(read("s")).toEqual({ a: 10, b: 20, c: 3 });
  });

  it("makes no step when nothing changed, and leaves out the parts that stayed", () => {
    const { setups, history, act } = world({ s: { a: 1, b: 2 } });
    expect(act([["s", "a"]], () => {})).toBe(false);
    expect(history.canUndo).toBe(false);
    act([["s", "a"], ["s", "b"]], () => setups.get("s")!.set("a", 5));
    expect(history.undo()?.parts.map((part) => part.id)).toEqual(["a"]);
  });

  it("brings a removed item back exactly, and removes it again", () => {
    const { setups, history, read, act } = world({ s: { a: 7, b: 2 } });
    act([["s", "a"], ["s", "b"]], () => {
      setups.get("s")!.delete("a");
      setups.get("s")!.delete("b");
    });
    expect(read("s")).toEqual({});
    history.undo();
    expect(read("s")).toEqual({ a: 7, b: 2 });
    history.redo();
    expect(read("s")).toEqual({});
  });

  it("undoes Move to… in both setups", () => {
    const { setups, history, read, act } = world({ from: { a: 1 }, to: {} });
    act([["from", "a"], ["to", "a"]], () => {
      setups.get("from")!.delete("a");
      setups.get("to")!.set("a", 1);
    });
    history.undo();
    expect([read("from"), read("to")]).toEqual([{ a: 1 }, {}]);
  });

  it("forgets what could be done again after something new", () => {
    const { setups, history, act } = world({ s: { a: 1 } });
    act([["s", "a"]], () => setups.get("s")!.set("a", 2));
    history.undo();
    act([["s", "a"]], () => setups.get("s")!.set("a", 3));
    expect(history.canRedo).toBe(false);
  });

  it("never writes over an item that changed since, drops that step and tries the one before", () => {
    const { setups, history, read, act } = world({ s: { a: 1, b: 1 } });
    act([["s", "a"]], () => setups.get("s")!.set("a", 2));
    act([["s", "b"]], () => setups.get("s")!.set("b", 2));
    // b is moved in the game: its step is stale.
    setups.get("s")!.set("b", 9);
    expect(history.undo()?.parts[0]?.id).toBe("a");
    expect(read("s")).toEqual({ a: 1, b: 9 });
    expect(history.canUndo).toBe(false);
  });

  it("drops a step of many when only one of them changed since", () => {
    const { setups, history, read, act } = world({ s: { a: 1, b: 1 } });
    act([["s", "a"], ["s", "b"]], () => {
      setups.get("s")!.set("a", 2);
      setups.get("s")!.set("b", 2);
    });
    setups.get("s")!.delete("b");
    expect(history.undo()).toBeNull();
    expect(read("s")).toEqual({ a: 2 });
  });

  it("lets an item leave before another comes back, so a full setup has the room", () => {
    const { setups, history, read, act, writes } = world({ s: { a: 1 } }, 1);
    // One step swaps a for b; undoing it takes b out before a comes back.
    act([["s", "a"], ["s", "b"]], () => {
      setups.get("s")!.delete("a");
      setups.get("s")!.set("b", 2);
    });
    writes.length = 0;
    history.undo();
    expect(read("s")).toEqual({ a: 1 });
    expect(writes).toEqual(["s.b=null", "s.a=1"]);
  });

  it("puts back what it wrote when a part can't be written, and drops the step", () => {
    const { setups, history, read, act } = world({ s: { a: 1, b: 1 } }, 2);
    act([["s", "a"], ["s", "b"]], () => {
      setups.get("s")!.set("a", 2);
      setups.get("s")!.delete("b");
    });
    // The setup filled up meanwhile: b can't come back.
    setups.get("s")!.set("c", 5);
    expect(history.undo()).toBeNull();
    expect(read("s")).toEqual({ a: 2, c: 5 });
    expect(history).toMatchObject({ canUndo: false, canRedo: false });
  });

  it("keeps at most its limit of steps", () => {
    const setups = { v: 0 };
    const history = new LayoutHistory<number>({ read: () => setups.v, write: (_part, to) => ((setups.v = to ?? 0), true), same: (a, b) => a === b }, 3);
    for (let value = 1; value <= 5; value++) history.record([{ setupId: "s", id: "a", before: value - 1, after: value }]), (setups.v = value);
    let undone = 0;
    while (history.undo()) undone++;
    expect(undone).toBe(3);
    expect(setups.v).toBe(2);
  });
});
