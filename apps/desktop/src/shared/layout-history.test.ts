import { describe, expect, it } from "vitest";
import { UndoStack } from "./layout-history";

describe("UndoStack", () => {
  it("takes steps back in reverse order and does them again", () => {
    const stack = new UndoStack<number>();
    stack.push({ target: "a", before: 1, after: 2 });
    stack.push({ target: "a", before: 2, after: 3 });
    expect(stack.undo()).toEqual({ target: "a", before: 2, after: 3 });
    expect(stack.undo()).toEqual({ target: "a", before: 1, after: 2 });
    expect(stack.undo()).toBeUndefined();
    expect(stack.redo()).toEqual({ target: "a", before: 1, after: 2 });
    expect(stack.redo()).toEqual({ target: "a", before: 2, after: 3 });
    expect(stack.redo()).toBeUndefined();
  });

  it("forgets what could be redone when something new is done", () => {
    const stack = new UndoStack<number>();
    stack.push({ target: "a", before: 1, after: 2 });
    stack.undo();
    expect(stack.canRedo).toBe(true);
    stack.push({ target: "a", before: 1, after: 5 });
    expect(stack.canRedo).toBe(false);
    expect(stack.canUndo).toBe(true);
  });

  it("keeps only the last steps up to its limit", () => {
    const stack = new UndoStack<number>(3);
    for (let i = 0; i < 5; i += 1) stack.push({ target: "a", before: i, after: i + 1 });
    expect(stack.undo()?.after).toBe(5);
    expect(stack.undo()?.after).toBe(4);
    expect(stack.undo()?.after).toBe(3);
    expect(stack.undo()).toBeUndefined();
  });

  it("drops the steps of a target that is gone", () => {
    const stack = new UndoStack<number>();
    stack.push({ target: "a", before: 1, after: 2 });
    stack.push({ target: "b", before: 1, after: 2 });
    stack.undo();
    stack.forget("b");
    expect(stack.canRedo).toBe(false);
    expect(stack.undo()?.target).toBe("a");
  });

  it("discards one step from both sides", () => {
    const stack = new UndoStack<number>();
    const first = { target: "a", before: 1, after: 2 };
    const second = { target: "a", before: 2, after: 3 };
    stack.push(first);
    stack.push(second);
    const taken = stack.undo()!;
    stack.discard(taken);
    expect(stack.canRedo).toBe(false);
    expect(stack.undo()).toBe(first);
    stack.discard(first);
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
  });

  it("clears", () => {
    const stack = new UndoStack<number>();
    stack.push({ target: "a", before: 1, after: 2 });
    stack.clear();
    expect(stack.canUndo).toBe(false);
  });
});
