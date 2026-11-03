import { describe, expect, it } from "vitest";
import { cleanExtent, cleanToasts, MAX_HOST_TOASTS, toastBounds, toastRoom, TOAST_GUTTER, TOAST_ROOM_MAX, TOAST_TOP_CLEARANCE } from "./host-toasts";

describe("toastBounds", () => {
  const area = { width: 1200, height: 800 };
  const extent = { width: 300, height: 48 };
  const width = 300 + 2 * TOAST_GUTTER;
  const height = 16 + 48 + TOAST_GUTTER;

  it("pins a bottom toast to the bottom edge, in the middle", () => {
    expect(toastBounds("bottom-center", extent, area)).toEqual({ x: (1200 - width) / 2, y: 800 - height, width, height });
  });

  it("pins a bottom right toast to the bottom right corner", () => {
    expect(toastBounds("bottom-right", extent, area)).toEqual({ x: 1200 - width, y: 800 - height, width, height });
  });

  it("starts a top toast under the header, which drags the window", () => {
    expect(toastBounds("top-center", extent, area)).toEqual({ x: (1200 - width) / 2, y: TOAST_TOP_CLEARANCE, width, height });
  });

  it("is only as big as the toasts, so presses elsewhere reach the panels", () => {
    const place = toastBounds("bottom-center", extent, area)!;
    expect(place.width).toBeLessThan(400);
    expect(place.height).toBeLessThan(120);
  });

  it("grows with a spread-out stack, on the side away from the edge", () => {
    const stack = toastBounds("bottom-center", { width: 300, height: 48 * 3 + 16 }, area)!;
    expect(stack.y + stack.height).toBe(800);
    expect(stack.height).toBe(16 + 48 * 3 + 16 + TOAST_GUTTER);
  });

  it("never goes beyond the window", () => {
    expect(toastBounds("bottom-center", { width: 3000, height: 3000 }, { width: 500, height: 400 })).toEqual({ x: 0, y: 0, width: 500, height: 400 });
    const top = toastBounds("top-center", { width: 300, height: 3000 }, { width: 500, height: 400 })!;
    expect(top.y + top.height).toBeLessThanOrEqual(400);
  });

  it("has no place without toasts or without a window", () => {
    expect(toastBounds("bottom-center", { width: 0, height: 0 }, area)).toBeNull();
    expect(toastBounds("bottom-center", extent, { width: 0, height: 0 })).toBeNull();
  });
});

describe("toastRoom", () => {
  it("is the window's width, up to what one toast needs", () => {
    expect(toastRoom(300)).toBe(300);
    expect(toastRoom(5000)).toBe(TOAST_ROOM_MAX);
    expect(toastRoom(-5)).toBe(0);
  });
});

describe("cleanExtent", () => {
  it("rounds up and keeps sizes in range", () => {
    expect(cleanExtent({ width: 200.2, height: 48 })).toEqual({ width: 201, height: 48 });
    expect(cleanExtent({ width: 1e9, height: 1e9 })).toEqual({ width: 4000, height: 4000 });
  });

  it("refuses anything that is not a size", () => {
    for (const raw of [null, "x", {}, { width: 1 }, { width: -1, height: 1 }, { width: NaN, height: 1 }, { width: Infinity, height: 1 }, { width: "1", height: 1 }]) expect(cleanExtent(raw)).toBeNull();
  });
});

describe("cleanToasts", () => {
  const toast = { id: 1, revision: 0, title: "Layout deleted" };

  it("keeps what a toast says and drops what it must not carry", () => {
    const [kept] = cleanToasts([{ ...toast, description: "d", variant: "success", duration: Infinity, testid: "undo-toast", actionTestid: "undo", action: "Undo", onClick: () => 1, evil: "x" }]);
    expect(kept).toEqual({ ...toast, description: "d", variant: "success", duration: Infinity, testid: "undo-toast", actionTestid: "undo", action: "Undo" });
  });

  it("leaves out entries that are not toasts", () => {
    expect(cleanToasts([null, 5, { id: "1", revision: 0, title: "x" }, { id: 1, revision: 0 }, { id: 1.5, revision: 0, title: "x" }, toast])).toEqual([toast]);
    expect(cleanToasts("nope")).toEqual([]);
  });

  it("ignores values outside the kit's kinds, durations and test ids", () => {
    expect(cleanToasts([{ ...toast, variant: "scary", duration: -1, testid: "has space", actionTestid: "<x>" }])).toEqual([toast]);
  });

  it("cuts long words and long lists", () => {
    const [long] = cleanToasts([{ ...toast, title: "x".repeat(5000) }]);
    expect(long!.title).toHaveLength(300);
    const many = Array.from({ length: 30 }, (_, id) => ({ id, revision: 0, title: String(id) }));
    const kept = cleanToasts(many);
    expect(kept).toHaveLength(MAX_HOST_TOASTS);
    expect(kept.at(-1)!.id).toBe(29);
  });
});
