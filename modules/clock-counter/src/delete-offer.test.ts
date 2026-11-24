// @vitest-environment jsdom
// A deleted clock or counter is gone at once, with Undo on a toast (the kit's undoable). Its hotkeys stay while the
// offer is open, so Undo brings it back working, and go once the delete is final, also when the panel closes first.
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleUndoKey, openUndos } from "../../shared/src/components/ui/toast/undoable";
import { toasts } from "../../shared/src/components/ui/toast/toast";
import { newItem } from "./items";
import { offerDelete } from "./delete-offer";

afterEach(() => {
  for (const offer of openUndos()) offer.close();
  toasts.value = [];
});

const item = newItem("counter", "c1", "Deaths");

describe("offerDelete", () => {
  it("brings the item back with Undo and keeps its hotkeys", async () => {
    const restore = vi.fn(() => true);
    const forget = vi.fn();
    const offer = offerDelete(item, 2, { title: "Deleted", restore, forget });
    expect(await offer.undo()).toBe(true);
    expect(restore).toHaveBeenCalledWith(item, 2);
    expect(forget).not.toHaveBeenCalled();
  });

  it("takes the newest delete back with Ctrl+Z", async () => {
    const restore = vi.fn(() => true);
    offerDelete(item, 0, { title: "Deleted", restore, forget: () => undefined });
    expect(handleUndoKey(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true }))).toBe(true);
    await Promise.resolve();
    expect(restore).toHaveBeenCalled();
  });

  it("drops its hotkeys once the delete is final, also when the panel closes first", () => {
    const forget = vi.fn();
    const offer = offerDelete(item, 0, { title: "Deleted", restore: () => true, forget });
    offer.close();
    expect(forget).toHaveBeenCalledWith(item);
  });

  it("says so when the item can't come back", async () => {
    const forget = vi.fn();
    const offer = offerDelete(item, 0, { title: "Deleted", restore: () => false, forget });
    expect(await offer.undo()).toBe(false);
    expect(forget).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalledWith(item);
  });
});
