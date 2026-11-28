// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isPictureToolKey, toolbarPlace, toolbarShift } from "./toolbar";

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

describe("isPictureToolKey", () => {
  const press = (target: string, init: KeyboardEventInit = { key: "9" }) => {
    document.body.innerHTML = `<div class="excalidraw"><canvas id="canvas"></canvas><textarea id="text"></textarea><div contenteditable="true"><span id="rich"></span></div></div><div id="outside"></div>`;
    let answer = false;
    const element = document.getElementById(target)!;
    element.addEventListener("keydown", (event) => (answer = isPictureToolKey(event)));
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    return answer;
  };

  it("is a plain 9 on the drawing, never while typing, with a modifier or outside the board", () => {
    expect(press("canvas")).toBe(true);
    expect(press("canvas", { key: "8" })).toBe(false);
    expect(press("canvas", { key: "9", ctrlKey: true })).toBe(false);
    expect(press("text")).toBe(false);
    expect(press("rich")).toBe(false);
    expect(press("outside")).toBe(false);
  });
});
