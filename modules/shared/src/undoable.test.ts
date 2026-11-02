// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, toAnnounce, toasts, type ToastItem } from "./components/ui/toast/toast";
import { setUiLanguage } from "./components/ui/text";
import { placeOf, reinsert } from "./reinsert";
import { isUndoKey, openUndos, settleUndos, undoable, undoLatest } from "./undoable";

/** A list with a delete and its undo, the way the callers use it. */
function list(...items: string[]) {
  const data = [...items];
  const same = (item: string) => item;
  const remove = (item: string) => {
    const place = placeOf(data, item, same)!;
    data.splice(place.index, 1);
    return undoable({
      title: `${item} deleted`,
      undo: () => {
        if (data.includes(item)) return false;
        data.splice(0, data.length, ...reinsert(data, item, place, same));
      },
    });
  };
  return { data, remove };
}

const pressUndo = (title: string) => {
  const item = toasts.value.find((toast) => toast.title === title)!;
  // What the toast's button does: the toast goes, then its action runs.
  dismissToast(item.id, "action");
  item.action!.onClick();
};

describe("undoable", () => {
  beforeEach(() => {
    settleUndos();
    toasts.value = [];
    setUiLanguage("en");
  });
  afterEach(() => vi.useRealTimers());

  it("shows a toast with Undo, for five seconds", () => {
    undoable({ title: "Layout deleted", undo: () => undefined });
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]).toMatchObject({ title: "Layout deleted", duration: 5000, testid: "undo-toast", actionTestid: "undo", actionKeys: "Control+Z" });
    expect(toasts.value[0]!.action!.label).toBe("Undo");
  });

  it("speaks German where the page does", () => {
    setUiLanguage("de");
    undoable({ title: "Layout gelöscht", undo: () => undefined });
    expect(toasts.value[0]!.action!.label).toBe("Rückgängig");
  });

  it("puts it back from the button, and the toast goes", async () => {
    const { data, remove } = list("a", "b", "c");
    remove("b");
    expect(data).toEqual(["a", "c"]);
    pressUndo("b deleted");
    await Promise.resolve();
    expect(data).toEqual(["a", "b", "c"]);
    expect(toasts.value).toEqual([]);
    expect(openUndos()).toBe(0);
  });

  it("is final once the time ran out, the toast was closed or pushed out", () => {
    const commits: string[] = [];
    const offer = (title: string) => undoable({ title, undo: () => undefined, commit: () => commits.push(title) });
    const timedOut = offer("a");
    dismissToast(toasts.value.find((toast) => toast.title === "a")!.id, "timeout");
    expect(timedOut.state).toBe("final");
    const closed = offer("b");
    dismissToast(toasts.value.find((toast) => toast.title === "b")!.id, "closed");
    expect(closed.state).toBe("final");
    // Three on screen at most: the fourth pushes the oldest out.
    const oldest = offer("c");
    offer("d");
    offer("e");
    offer("f");
    expect(oldest.state).toBe("final");
    expect(commits).toEqual(["a", "b", "c"]);
  });

  it("can't be undone once it's final, and commits once", async () => {
    const commit = vi.fn();
    const undo = vi.fn();
    const offer = undoable({ title: "x", undo, commit });
    offer.commit();
    offer.commit();
    expect(await offer.undo()).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(toasts.value).toEqual([]);
  });

  it("undoes once, even when pressed twice", async () => {
    const undo = vi.fn();
    const offer = undoable({ title: "x", undo });
    const first = offer.undo();
    const second = offer.undo();
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("keeps two quick deletes apart: undoing the first leaves the second deleted and undoable", async () => {
    const { data, remove } = list("a", "b", "c");
    const first = remove("a");
    const second = remove("c");
    expect(toasts.value.map((toast) => toast.title)).toEqual(["a deleted", "c deleted"]);
    expect(await first.undo()).toBe(true);
    expect(data).toEqual(["a", "b"]);
    expect(second.state).toBe("open");
    expect(toasts.value.map((toast) => toast.title)).toEqual(["c deleted"]);
    expect(await second.undo()).toBe(true);
    expect(data).toEqual(["a", "b", "c"]);
  });

  it("undoes the second of two quick deletes without touching the first", async () => {
    const { data, remove } = list("a", "b", "c");
    const first = remove("a");
    remove("b");
    expect(await undoLatest()).toBe(true);
    expect(data).toEqual(["b", "c"]);
    expect(first.state).toBe("open");
  });

  it("Ctrl+Z takes the newest open one, then the one before, then nothing", async () => {
    const { data, remove } = list("a", "b", "c");
    remove("a");
    remove("b");
    expect(await undoLatest()).toBe(true);
    expect(data).toEqual(["b", "c"]);
    expect(await undoLatest()).toBe(true);
    expect(data).toEqual(["a", "b", "c"]);
    expect(await undoLatest()).toBe(false);
  });

  it("says so when it can't be put back, and changes nothing", async () => {
    const { data, remove } = list("a", "b");
    const offer = remove("a");
    // Made again meanwhile, under the same name.
    data.unshift("a");
    expect(await offer.undo()).toBe(false);
    expect(data).toEqual(["a", "b"]);
    expect(toasts.value.map((toast) => [toast.variant, toast.title])).toEqual([["error", "Can't undo that anymore."]]);
  });

  it("shows the reason an undo threw, when the caller turns it into words", async () => {
    const offer = undoable({
      title: "x",
      undo: () => Promise.reject(new Error("That workspace is gone.")),
      failed: (reason) => (reason instanceof Error ? reason.message : undefined),
    });
    expect(await offer.undo()).toBe(false);
    expect(toasts.value.at(-1)).toMatchObject({ variant: "error", title: "That workspace is gone." });
  });

  it("waits for an undo that takes a while", async () => {
    let finish!: () => void;
    const offer = undoable({ title: "x", undo: () => new Promise<void>((resolve) => (finish = resolve)) });
    const done = offer.undo();
    expect(offer.state).toBe("undone");
    finish();
    expect(await done).toBe(true);
  });

  it("makes every open delete final when the page goes away", () => {
    const commit = vi.fn();
    undoable({ title: "a", undo: () => undefined, commit });
    undoable({ title: "b", undo: () => undefined, commit });
    dispatchEvent(new Event("pagehide"));
    expect(commit).toHaveBeenCalledTimes(2);
    expect(openUndos()).toBe(0);
  });

  it("a commit that throws doesn't stop the others", () => {
    const later = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    undoable({
      title: "a",
      undo: () => undefined,
      commit: () => {
        throw new Error("boom");
      },
    });
    undoable({ title: "b", undo: () => undefined, commit: later });
    settleUndos();
    expect(later).toHaveBeenCalledOnce();
  });
});

describe("reinsert", () => {
  const id = (item: string) => item;

  it("puts an item back after the one that was before it", () => {
    const place = placeOf(["a", "b", "c", "d"], "c", id)!;
    expect(place).toEqual({ index: 2, after: "b", before: "d" });
    // "a" was deleted meanwhile: the old index would put "c" after "d"'s neighbour, not after "b".
    expect(reinsert(["b", "d"], "c", place, id)).toEqual(["b", "c", "d"]);
  });

  it("puts the first item back at the top", () => {
    const place = placeOf(["a", "b"], "a", id)!;
    expect(reinsert(["x", "b"], "a", place, id)).toEqual(["a", "x", "b"]);
  });

  it("falls back to the old index, or the end, when its neighbour is gone too", () => {
    expect(reinsert(["a", "d"], "c", { index: 2, after: "b" }, id)).toEqual(["a", "d", "c"]);
    expect(reinsert(["a", "d", "e"], "c", { index: 1, after: "b" }, id)).toEqual(["a", "c", "d", "e"]);
    // The one before is gone, the one after is there: right before that.
    expect(reinsert(["a", "x", "d"], "c", { index: 2, after: "b", before: "d" }, id)).toEqual(["a", "x", "c", "d"]);
    // It was last: the end.
    expect(reinsert(["a", "x"], "c", { index: 1, after: "b", before: null }, id)).toEqual(["a", "x", "c"]);
  });

  it("knows nothing of an item that isn't there", () => {
    expect(placeOf(["a"], "z", id)).toBeNull();
  });
});

describe("isUndoKey", () => {
  const key = (init: KeyboardEventInit, target?: Element) => {
    const event = new KeyboardEvent("keydown", init);
    if (target) Object.defineProperty(event, "target", { value: target });
    return isUndoKey(event);
  };

  it("is Ctrl+Z or Cmd+Z alone", () => {
    expect(key({ key: "z", ctrlKey: true })).toBe(true);
    expect(key({ key: "Z", metaKey: true })).toBe(true);
    expect(key({ key: "z" })).toBe(false);
    expect(key({ key: "z", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(key({ key: "z", ctrlKey: true, altKey: true })).toBe(false);
    expect(key({ key: "y", ctrlKey: true })).toBe(false);
  });

  it("leaves text fields their own undo", () => {
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const inside = document.createElement("span");
    editor.append(inside);
    expect(key({ key: "z", ctrlKey: true }, input)).toBe(false);
    expect(key({ key: "z", ctrlKey: true }, inside)).toBe(false);
    expect(key({ key: "z", ctrlKey: true }, document.createElement("button"))).toBe(true);
  });
});

describe("toAnnounce", () => {
  const item = (id: number, title: string, extra: Partial<ToastItem> = {}): ToastItem => ({ id, title, revision: 0, ...extra });

  it("reads each toast out once, errors as alerts", () => {
    const heard = new Map<number, number>();
    expect(toAnnounce([item(1, "Layout deleted")], heard)).toEqual({ status: "Layout deleted" });
    expect(toAnnounce([item(1, "Layout deleted")], heard)).toEqual({});
    expect(toAnnounce([item(1, "Layout deleted"), item(2, "Oops", { variant: "error" })], heard)).toEqual({ alert: "Oops" });
  });

  it("does not read an older toast again when a newer one goes", () => {
    const heard = new Map<number, number>();
    toAnnounce([item(1, "a")], heard);
    toAnnounce([item(1, "a"), item(2, "b")], heard);
    expect(toAnnounce([item(1, "a")], heard)).toEqual({});
  });

  it("reads a toast again when its content changes, with its second line", () => {
    const heard = new Map<number, number>();
    toAnnounce([item(1, "Saving")], heard);
    expect(toAnnounce([item(1, "Saved", { revision: 1, description: "All good" })], heard)).toEqual({ status: "Saved. All good" });
  });
});
