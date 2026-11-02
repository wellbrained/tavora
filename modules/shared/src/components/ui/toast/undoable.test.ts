import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, toast, toasts } from "./toast";
import { handleUndoKey, openUndos, undoable } from "./undoable";

/** A keydown as the page gets it; `target` stands in for where the focus is. */
function key(init: KeyboardEventInit & { target?: unknown }): KeyboardEvent {
  const { target = null, ...rest } = init;
  let prevented = false;
  return {
    key: "z",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...rest,
    target,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault: () => (prevented = true),
  } as unknown as KeyboardEvent;
}

/** The Undo button of the toast with this title, pressed as ToastItem does: its action, then the dismiss. */
function press(title: string): void {
  const item = toasts.value.find((candidate) => candidate.title === title)!;
  item.action!.onClick();
  dismissToast(item.id);
}

describe("undoable", () => {
  beforeEach(() => {
    toasts.value = [];
  });
  afterEach(() => {
    for (const offer of [...openUndos()]) offer.drop();
  });

  it("shows a toast with Undo and puts the thing back once", async () => {
    const undo = vi.fn();
    const onFinal = vi.fn();
    const offer = undoable({ title: "Layout deleted", undo, onFinal });
    expect(toasts.value).toMatchObject([{ title: "Layout deleted", testid: "undo-toast", actionTestid: "undo", action: { label: "Undo" } }]);
    press("Layout deleted");
    await Promise.resolve();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(offer.state).toBe("undone");
    expect(toasts.value).toEqual([]);
    expect(onFinal).not.toHaveBeenCalled();
    // Pressed again (a second click that was already on its way), Ctrl+Z, or undo(): nothing more happens.
    expect(await offer.undo()).toBe(false);
    expect(handleUndoKey(key({ ctrlKey: true }))).toBe(false);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("is final once the toast goes without Undo", async () => {
    const undo = vi.fn();
    const onFinal = vi.fn();
    const offer = undoable({ title: "Gone", undo, onFinal });
    dismissToast(toasts.value[0]!.id);
    expect(offer.state).toBe("final");
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(await offer.undo()).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    expect(openUndos()).toEqual([]);
  });

  it("is final when newer toasts push it out", () => {
    const onFinal = vi.fn();
    const offer = undoable({ title: "First", undo: () => undefined, onFinal });
    for (const title of ["b", "c", "d"]) toast({ title });
    expect(offer.state).toBe("final");
    expect(onFinal).toHaveBeenCalledTimes(1);
  });

  it("gives two quick deletes an undo each; undoing the first leaves the second alone", async () => {
    const back: string[] = [];
    const final: string[] = [];
    const first = undoable({ title: "To-do deleted", undo: () => void back.push("a"), onFinal: () => final.push("a") });
    const second = undoable({ title: "Group deleted", undo: () => void back.push("b"), onFinal: () => final.push("b") });
    expect(toasts.value.map((item) => item.title)).toEqual(["To-do deleted", "Group deleted"]);
    press("To-do deleted");
    await Promise.resolve();
    expect(back).toEqual(["a"]);
    expect(first.state).toBe("undone");
    expect(second.state).toBe("open");
    expect(toasts.value.map((item) => item.title)).toEqual(["Group deleted"]);
    // The second still works, and only brings back itself.
    await second.undo();
    expect(back).toEqual(["a", "b"]);
    expect(final).toEqual([]);
  });

  it("tells the user when the thing can't come back, and ends the offer", async () => {
    const onFinal = vi.fn();
    const refused = undoable({ title: "Frame deleted", undo: () => false, onFinal });
    expect(await refused.undo()).toBe(false);
    expect(refused.state).toBe("final");
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(toasts.value).toMatchObject([{ title: "Can't undo that anymore", testid: "undo-gone" }]);
    const failed = undoable({ title: "Layout deleted", undo: () => Promise.reject(new Error("gone")) });
    expect(await failed.undo()).toBe(false);
    expect(failed.state).toBe("final");
  });

  it("waits for an undo that takes a while, and can't be started twice meanwhile", async () => {
    let finish!: () => void;
    const undo = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const offer = undoable({ title: "Workspace deleted", undo });
    const running = offer.undo();
    expect(offer.state).toBe("undoing");
    expect(await offer.undo()).toBe(false);
    finish();
    expect(await running).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("drop ends the offer without making it final (it came back another way)", () => {
    const onFinal = vi.fn();
    const offer = undoable({ title: "Frame deleted", undo: () => undefined, onFinal, key: false });
    offer.drop();
    expect(toasts.value).toEqual([]);
    expect(onFinal).not.toHaveBeenCalled();
  });

  describe("Ctrl+Z", () => {
    it("takes back the newest open delete, one per press", async () => {
      const back: string[] = [];
      undoable({ title: "a", undo: () => void back.push("a") });
      undoable({ title: "b", undo: () => void back.push("b") });
      const event = key({ ctrlKey: true });
      expect(handleUndoKey(event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      await Promise.resolve();
      expect(back).toEqual(["b"]);
      expect(handleUndoKey(key({ metaKey: true }))).toBe(true);
      await Promise.resolve();
      expect(back).toEqual(["b", "a"]);
      expect(handleUndoKey(key({ ctrlKey: true }))).toBe(false);
    });

    it("leaves other keys, text fields, a key already used and offers kept off the key alone", () => {
      const undo = vi.fn();
      undoable({ title: "Frame deleted", undo, key: false });
      expect(handleUndoKey(key({ ctrlKey: true }))).toBe(false);
      undoable({ title: "Layout deleted", undo });
      expect(handleUndoKey(key({ key: "z" }))).toBe(false);
      expect(handleUndoKey(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
      expect(handleUndoKey(key({ ctrlKey: true, key: "y" }))).toBe(false);
      const used = key({ ctrlKey: true });
      used.preventDefault();
      expect(handleUndoKey(used)).toBe(false);
      expect(undo).not.toHaveBeenCalled();
    });
  });
});
