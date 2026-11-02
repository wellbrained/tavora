import { describe, expect, it } from "vitest";
import { centeredTop, cubicBezier, easeOutStrong } from "./smooth-scroll";

describe("cubicBezier", () => {
  it("starts at 0 and ends at 1", () => {
    expect(easeOutStrong(0)).toBe(0);
    expect(easeOutStrong(1)).toBe(1);
  });

  it("is a straight line for a linear curve", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0.25)).toBeCloseTo(0.25, 3);
    expect(linear(0.5)).toBeCloseTo(0.5, 3);
  });

  it("an ease-out is most of the way there early on, and never goes backwards", () => {
    expect(easeOutStrong(0.2)).toBeGreaterThan(0.5);
    let before = 0;
    for (let time = 0; time <= 1; time += 0.05) {
      const now = easeOutStrong(time);
      expect(now).toBeGreaterThanOrEqual(before - 1e-9);
      before = now;
    }
  });
});

describe("centeredTop", () => {
  // A 400 high panel on the screen from 100 to 500, 2000 of content.
  const box = { top: 100, height: 400 };

  it("puts an element below the fold in the middle", () => {
    // The element is 800 down the content (900 on the screen, panel not scrolled) and 40 high.
    expect(centeredTop(box, { top: 900, height: 40 }, 0, 2000)).toBe(800 + 20 - 200);
  });

  it("counts what is already scrolled", () => {
    // Scrolled 300; the element sits 50 into the panel (150 on the screen).
    expect(centeredTop(box, { top: 150, height: 40 }, 300, 2000)).toBe(300 + 50 + 20 - 200);
  });

  it("stops at the top and at the end", () => {
    expect(centeredTop(box, { top: 110, height: 40 }, 0, 2000)).toBe(0);
    expect(centeredTop(box, { top: 2000, height: 40 }, 0, 2000)).toBe(1600);
  });

  it("does not scroll a panel that fits", () => {
    expect(centeredTop(box, { top: 300, height: 40 }, 0, 400)).toBe(0);
  });
});
