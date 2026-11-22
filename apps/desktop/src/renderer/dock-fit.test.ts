// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { backOff, fitDelta, moveSash, sashSides } from "./dock-fit";

// jsdom has no layout, so each view's box is given by hand.
function boxed<T extends HTMLElement>(element: T, top: number, height: number, left = 0, width = 300): T {
  element.getBoundingClientRect = () => ({ top, height, bottom: top + height, left, width, right: left + width, x: left, y: top, toJSON: () => ({}) });
  return element;
}

/** A dockview split: views stacked from y 0 with an 8 px gap, and a line in each gap. */
function stack(heights: number[], orientation = "dv-vertical") {
  const container = document.createElement("div");
  container.className = `dv-split-view-container ${orientation}`;
  const sashes = document.createElement("div");
  sashes.className = "dv-sash-container";
  const views = document.createElement("div");
  views.className = "dv-view-container";
  container.append(sashes, views);
  const across = orientation === "dv-horizontal";
  const place = <T extends HTMLElement>(element: T, start: number, size: number) => (across ? boxed(element, 0, 300, start, size) : boxed(element, start, size));
  let top = 0;
  const lines: HTMLElement[] = [];
  const parts: HTMLElement[] = [];
  heights.forEach((height, index) => {
    const view = document.createElement("div");
    view.className = "dv-view";
    parts.push(place(view, top, height));
    top += height;
    if (index < heights.length - 1) {
      const sash = document.createElement("div");
      sash.className = "dv-sash";
      lines.push(place(sash, top, 8));
      top += 8;
    }
  });
  // Dockview adds lines at the end of their container, whatever their place.
  sashes.append(...lines.reverse());
  views.append(...parts);
  document.body.append(container);
  return { lines: lines.reverse(), parts };
}

describe("fitDelta", () => {
  it("grows the side before the line first", () => {
    expect(fitDelta(40, 90)).toBe(40);
  });
  it("grows the side after the line when only it scrolls", () => {
    expect(fitDelta(0, 90)).toBe(-90);
  });
  it("leaves the line when nothing scrolls", () => {
    expect(fitDelta(0, 0)).toBe(0);
  });
});

describe("backOff", () => {
  it("moves the line back just as far as the giving side now scrolls", () => {
    expect(backOff(1300, 450)).toBe(-450);
    expect(backOff(-200, 30)).toBe(30);
  });
  it("never moves it back past where it started", () => {
    expect(backOff(100, 400)).toBe(-100);
    expect(backOff(-100, 400)).toBe(100);
  });
  it("leaves it when the giving side still fits", () => {
    expect(backOff(300, 0)).toBe(0);
  });
});

describe("sashSides", () => {
  it("finds the areas next to the line by where they are", () => {
    const { lines, parts } = stack([100, 200, 150]);
    expect(sashSides(lines[1]!)).toEqual({ axis: "y", before: parts[1], after: parts[2] });
    expect(sashSides(lines[0]!)).toEqual({ axis: "y", before: parts[0], after: parts[1] });
  });

  it("skips a hidden area", () => {
    const { lines, parts } = stack([100, 0, 150]);
    expect(sashSides(lines[1]!)?.before).toBe(parts[0]);
  });

  it("reads panels side by side across", () => {
    const { lines } = stack([100, 100], "dv-horizontal");
    expect(sashSides(lines[0]!)?.axis).toBe("x");
  });

  it("gives nothing for a line outside a split", () => {
    expect(sashSides(document.createElement("div"))).toBeNull();
  });
});

describe("moveSash", () => {
  it("drags the line by the amount along its axis", () => {
    const { lines } = stack([100, 100]);
    const seen: string[] = [];
    const record = (event: Event) => {
      const pointer = event as PointerEvent;
      seen.push(`${event.type} ${pointer.clientX},${pointer.clientY}`);
    };
    lines[0]!.addEventListener("pointerdown", record);
    const move = vi.fn(record);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", record);
    moveSash(lines[0]!, "y", 40);
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", record);
    expect(seen).toEqual(["pointerdown 150,104", "pointermove 150,144", "pointerup 150,144"]);
  });
});
