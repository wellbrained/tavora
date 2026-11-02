import { describe, expect, it } from "vitest";
import { DIALOG_INSET, DIALOG_USUAL_HEIGHT, dialogPlace } from "./panel-dialog-place";

describe("a panel's dialog", () => {
  it("sits in the middle of the workspace area, not of the window", () => {
    // The rail takes the left 72 pixels and the header the top 56.
    const place = dialogPlace({ left: 80, top: 56, width: 1200, height: 800 });
    expect(place).toMatchObject({ left: `${80 + 600}px`, top: `${56 + 400}px` });
  });

  it("fits inside the workspace area with room to its edges", () => {
    expect(dialogPlace({ left: 80, top: 56, width: 700, height: 500 })).toMatchObject({
      maxWidth: `${700 - 2 * DIALOG_INSET}px`,
      maxHeight: `${500 - 2 * DIALOG_INSET}px`,
    });
  });

  it("hangs a shorter dialog from the top edge of a usual one", () => {
    const room = { left: 80, top: 56, width: 1200, height: 900 };
    const usual = dialogPlace(room, DIALOG_USUAL_HEIGHT)!;
    const short = dialogPlace(room, 400)!;
    const edge = (place: { top: string }, height: number) => parseFloat(place.top) - height / 2;
    expect(edge(short, 400)).toBeCloseTo(edge(usual, DIALOG_USUAL_HEIGHT));
    expect(edge(usual, DIALOG_USUAL_HEIGHT)).toBeCloseTo(56 + (900 - DIALOG_USUAL_HEIGHT) / 2);
  });

  it("centres a dialog taller than a usual one", () => {
    const room = { left: 80, top: 56, width: 1200, height: 900 };
    expect(dialogPlace(room, 850)).toMatchObject({ top: `${56 + 450}px` });
  });

  it("keeps the room's inset above a shorter dialog when a usual one would fill the room", () => {
    const small = { left: 80, top: 56, width: 1200, height: 500 };
    expect(dialogPlace(small, 400)).toMatchObject({ top: `${56 + DIALOG_INSET + 200}px` });
  });

  it("falls back to the window without a workspace area", () => {
    expect(dialogPlace(null)).toBeNull();
    expect(dialogPlace({ left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});
