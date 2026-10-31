import { describe, expect, it } from "vitest";
import { DIALOG_INSET, dialogPlace } from "./panel-dialog-place";

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

  it("falls back to the window without a workspace area", () => {
    expect(dialogPlace(null)).toBeNull();
    expect(dialogPlace({ left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});
