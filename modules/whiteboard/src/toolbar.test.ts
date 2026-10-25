import { describe, expect, it } from "vitest";
import { toolbarPlace, toolbarShift } from "./toolbar";

describe("toolbarPlace", () => {
  it("is top unless bottom was chosen", () => {
    expect(toolbarPlace("bottom")).toBe("bottom");
    expect(toolbarPlace("top")).toBe("top");
    expect(toolbarPlace(null)).toBe("top");
    expect(toolbarPlace(3)).toBe("top");
  });
});

describe("toolbarShift", () => {
  it("moves the toolbar down to just above the buttons below it, never up", () => {
    expect(toolbarShift(70, 500)).toBe(422);
    expect(toolbarShift(70, 60)).toBe(0);
  });
});
