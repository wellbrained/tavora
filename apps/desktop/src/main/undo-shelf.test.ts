import { afterEach, describe, expect, it, vi } from "vitest";
import { UndoGoneError, UndoShelf } from "./undo-shelf";

describe("UndoShelf", () => {
  afterEach(() => vi.useRealTimers());

  it("puts a delete back once by its token", async () => {
    const shelf = new UndoShelf();
    const restore = vi.fn();
    const token = shelf.keep(restore);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    await shelf.undo(token);
    expect(restore).toHaveBeenCalledTimes(1);
    await expect(shelf.undo(token)).rejects.toBeInstanceOf(UndoGoneError);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("keeps each delete apart: undoing one leaves the other", async () => {
    const shelf = new UndoShelf();
    const back: string[] = [];
    const first = shelf.keep(() => void back.push("first"));
    const second = shelf.keep(() => void back.push("second"));
    await shelf.undo(first);
    expect(back).toEqual(["first"]);
    expect(shelf.size).toBe(1);
    await shelf.undo(second);
    expect(back).toEqual(["first", "second"]);
  });

  it("makes the delete final once forgotten, or after a while if nobody says", async () => {
    vi.useFakeTimers();
    const shelf = new UndoShelf(1000);
    const restore = vi.fn();
    const forgotten = shelf.keep(restore);
    shelf.forget(forgotten);
    await expect(shelf.undo(forgotten)).rejects.toBeInstanceOf(UndoGoneError);
    const lost = shelf.keep(restore);
    vi.advanceTimersByTime(1001);
    expect(shelf.size).toBe(0);
    await expect(shelf.undo(lost)).rejects.toBeInstanceOf(UndoGoneError);
    expect(restore).not.toHaveBeenCalled();
  });

  it("passes on a restore that finds its place gone, and the token is used up", async () => {
    const shelf = new UndoShelf();
    const token = shelf.keep(() => {
      throw new UndoGoneError();
    });
    await expect(shelf.undo(token)).rejects.toBeInstanceOf(UndoGoneError);
    expect(shelf.size).toBe(0);
  });
});
