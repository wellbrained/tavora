// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { canvasBackgroundPick } from "./excalidrawDom";

const palette = (testid: string) => {
  const root = document.createElement("div");
  root.innerHTML = `<div class="App-menu__left"><button data-testid="${testid}"><span class="swatch"></span></button></div><button data-testid="color-top-pick-#000000" class="outside"></button>`;
  return root;
};
const none = { selectedElementIds: {}, activeTool: { type: "selection" } };

describe("canvasBackgroundPick", () => {
  it("reads the colour of a swatch clicked in the palette while nothing is selected", () => {
    const root = palette("color-top-pick-#ffffff");
    expect(canvasBackgroundPick(root.querySelector(".swatch"), none)).toBe("#ffffff");
    expect(canvasBackgroundPick(palette("color-top-pick-transparent").querySelector("button"), none)).toBe("transparent");
  });

  it("is null for a swatch of a shape (a selection or a drawing tool) and for clicks elsewhere", () => {
    const root = palette("color-top-pick-#ffffff");
    const swatch = root.querySelector(".swatch");
    expect(canvasBackgroundPick(swatch, { selectedElementIds: { a: true }, activeTool: { type: "selection" } })).toBeNull();
    expect(canvasBackgroundPick(swatch, { selectedElementIds: {}, activeTool: { type: "rectangle" } })).toBeNull();
    expect(canvasBackgroundPick(root.querySelector(".outside"), none)).toBeNull();
    expect(canvasBackgroundPick(null, none)).toBeNull();
  });
});
