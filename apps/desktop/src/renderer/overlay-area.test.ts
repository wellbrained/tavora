import { describe, expect, it } from "vitest";
import type { Layer } from "@tavora/official-ui/lib/layers";
import { answerStep, askAllStep, CLOSING_HOLD_MS, dialogsHolding, isPlaced, measureStep, NO_WATCH, openWatch, panelsUnder, POPUP_MARGIN, POPUP_WAIT_FRAMES, type MeasuredPopup } from "./overlay-area";

const panels = [
  { instanceId: "left", x: 0, y: 40, width: 400, height: 600 },
  { instanceId: "right", x: 408, y: 40, width: 400, height: 600 },
];

describe("panelsUnder", () => {
  it("names only the panels a popup lies over", () => {
    expect(panelsUnder({ x: 100, y: 100, width: 200, height: 200 }, panels)).toEqual(["left"]);
    expect(panelsUnder({ x: 300, y: 100, width: 200, height: 200 }, panels)).toEqual(["left", "right"]);
  });

  it("counts the popup's shadow, and leaves a popup over the header alone", () => {
    // A hint below a header button, ending just above the panels.
    expect(panelsUnder({ x: 100, y: 0, width: 80, height: 40 - POPUP_MARGIN - 1 }, panels)).toEqual([]);
    expect(panelsUnder({ x: 100, y: 0, width: 80, height: 40 - POPUP_MARGIN + 1 }, panels)).toEqual(["left"]);
  });
});

describe("isPlaced", () => {
  const viewport = { width: 1000, height: 800 };
  it("waits for a popup that is hidden, has no size or still waits above the window", () => {
    expect(isPlaced({ x: 10, y: 10, width: 100, height: 50 }, false, viewport)).toBe(true);
    expect(isPlaced({ x: 10, y: 10, width: 100, height: 50 }, true, viewport)).toBe(false);
    expect(isPlaced({ x: 10, y: 10, width: 0, height: 50 }, false, viewport)).toBe(false);
    expect(isPlaced({ x: 10, y: -500, width: 100, height: 50 }, false, viewport)).toBe(false);
  });
});

describe("dialogsHolding", () => {
  const layer = (id: number, state: Layer["state"], kind: Layer["kind"] = "dialog"): Layer => ({ id, kind, state, modal: true, element: null, name: undefined });

  it("counts open dialogs and closing ones until their fade is over, never menus", () => {
    const since = new Map<number, number>();
    expect(dialogsHolding([layer(1, "open"), layer(2, "open", "menu")], since, 0)).toEqual({ count: 1, recheckIn: null });
    expect(dialogsHolding([layer(1, "closing")], since, 1000)).toEqual({ count: 1, recheckIn: CLOSING_HOLD_MS });
    expect(dialogsHolding([layer(1, "closing")], since, 1100)).toEqual({ count: 1, recheckIn: CLOSING_HOLD_MS - 100 });
    // Kept on the page while closed: it lets go all the same.
    expect(dialogsHolding([layer(1, "closing")], since, 1000 + CLOSING_HOLD_MS)).toEqual({ count: 0, recheckIn: null });
  });

  it("starts over for a dialog that opens again and closes once more", () => {
    const since = new Map<number, number>();
    dialogsHolding([layer(1, "closing")], since, 0);
    dialogsHolding([layer(1, "open")], since, 50);
    expect(since.size).toBe(0);
    expect(dialogsHolding([layer(1, "closing")], since, 5000)).toEqual({ count: 1, recheckIn: CLOSING_HOLD_MS });
    dialogsHolding([], since, 5100);
    expect(since.size).toBe(0);
  });
});

describe("the popups of a menu or hint (measureStep, answerStep)", () => {
  const viewport = { width: 1000, height: 800 };
  const over = (popup: string, x: number, hidden = false): MeasuredPopup<string> => ({ popup, box: { x, y: 100, width: 150, height: 100 }, hidden });
  const OVER_LEFT = 100;
  const OVER_RIGHT = 500;
  const OVER_NOTHING = 850;

  it("waits for a popup to be placed, then asks for the panels under it and holds it until the answer", () => {
    const open = openWatch(NO_WATCH);
    const waiting = measureStep(open, [over("menu", OVER_LEFT, true)], panels, viewport);
    expect(waiting.request).toBeNull();
    const first = measureStep(waiting.watch, [over("menu", OVER_LEFT)], panels, viewport);
    expect(first.request).toEqual({ seq: 1, only: ["left"] });
    expect(first.watch.awaited).toBe(1);
    expect(first.hold).toEqual([{ popup: "menu", seq: 1 }]);
    const answered = answerStep(first.watch, 1);
    expect(answered.showAll).toBe(true);
    // Answered: the same popup may show now, and nothing more is asked.
    const after = measureStep(answered.watch, [over("menu", OVER_LEFT)], panels, viewport);
    expect(after.request).toBeNull();
    expect(after.show).toEqual(["menu"]);
  });

  it("tells the host a menu is open even when it lies over no panel", () => {
    const first = measureStep(openWatch(NO_WATCH), [over("hint", OVER_NOTHING)], panels, viewport);
    expect(first.request).toEqual({ seq: 1, only: [] });
    expect(first.show).toEqual(["hint"]);
  });

  it("asks for every panel when no popup shows up", () => {
    let watch = openWatch(NO_WATCH);
    for (let frame = 1; frame < POPUP_WAIT_FRAMES; frame++) {
      const step = measureStep(watch, [], panels, viewport);
      expect(step.request).toBeNull();
      watch = step.watch;
    }
    const last = measureStep(watch, [], panels, viewport);
    expect(last.request).toEqual({ seq: 1 });
    expect(last.watch.asked).toBe("all");
    expect(measureStep(last.watch, [over("menu", OVER_LEFT)], panels, viewport).request).toBeNull();
  });

  it("holds a second popup over a panel asked for a moment ago, and asks only for new panels", () => {
    const first = measureStep(openWatch(NO_WATCH), [over("menu", OVER_LEFT)], panels, viewport);
    // Before the answer, a submenu opens over the same panel: it waits for that request too, nothing new is asked.
    const sub = measureStep(first.watch, [over("menu", OVER_LEFT), over("submenu", OVER_LEFT + 40)], panels, viewport);
    expect(sub.request).toBeNull();
    expect(sub.hold).toEqual([
      { popup: "menu", seq: 1 },
      { popup: "submenu", seq: 1 },
    ]);
    // Answered, the next hint moves over the other panel: only that one is asked, and the hint waits for it.
    const answered = answerStep(sub.watch, 1).watch;
    const moved = measureStep(answered, [over("hint", OVER_RIGHT)], panels, viewport);
    expect(moved.request).toEqual({ seq: 2, only: ["right"] });
    expect(moved.hold).toEqual([{ popup: "hint", seq: 2 }]);
    // The first answer still shows everything that waited for it; the second does not change that.
    expect(answerStep(moved.watch, 2).showAll).toBe(true);
  });

  it("ignores a stale answer", () => {
    // An earlier overlay's request 3 was never answered; this one asks request 4.
    const before = { ...NO_WATCH, seq: 3 };
    const first = measureStep(openWatch(before), [over("menu", OVER_LEFT)], panels, viewport);
    expect(first.request?.seq).toBe(4);
    const stale = answerStep(first.watch, 3);
    expect(stale.showAll).toBe(false);
    expect(measureStep(stale.watch, [over("menu", OVER_LEFT)], panels, viewport).hold).toEqual([{ popup: "menu", seq: 4 }]);
    expect(answerStep(stale.watch, 4).showAll).toBe(true);
    // Before the first request of an overlay, no answer shows anything.
    expect(answerStep(openWatch(before), 3).showAll).toBe(false);
  });

  it("asks for every panel for a dialog, with its answer awaited", () => {
    const first = measureStep(openWatch(NO_WATCH), [over("menu", OVER_LEFT)], panels, viewport);
    const all = askAllStep(first.watch);
    expect(all.request).toEqual({ seq: 2 });
    expect(answerStep(all.watch, 1).showAll).toBe(false);
    expect(answerStep(all.watch, 2).showAll).toBe(true);
  });
});
