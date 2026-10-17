import { describe, expect, it } from "vitest";
import { toolbarPlace, toolbarShift } from "./Toolbar";
import { pictureName } from "./App";

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

describe("pictureName", () => {
  it("is the board's name and when it was saved", () => {
    expect(pictureName("Board 1", new Date(2026, 9, 7, 9, 5))).toBe("Board 1 2026-10-07 09-05");
  });
});
