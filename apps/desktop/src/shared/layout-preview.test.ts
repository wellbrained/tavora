import { describe, expect, it } from "vitest";
import { previewAspect, ratioLabel } from "./layout-preview";

describe("ratioLabel", () => {
  it("names the usual shapes, a hair off included", () => {
    expect(ratioLabel(1920, 1080)).toBe("16:9");
    expect(ratioLabel(2560, 1600)).toBe("16:10");
    expect(ratioLabel(2560, 1080)).toBe("21:9");
    expect(ratioLabel(3440, 1440)).toBe("21:9");
    expect(ratioLabel(5120, 1440)).toBe("32:9");
    expect(ratioLabel(1080, 1920)).toBe("9:16");
  });
  it("gives a number for the rest", () => {
    expect(ratioLabel(2000, 1000)).toBe("2.00:1");
  });
});

describe("previewAspect", () => {
  const monitors = [{ id: 2, width: 2560, height: 1440 }];
  it("reads the fixed shapes and the monitors, and nothing else", () => {
    expect(previewAspect("21:9", monitors)).toBeCloseTo(21 / 9);
    expect(previewAspect("monitor:2", monitors)).toBeCloseTo(16 / 9);
    expect(previewAspect("monitor:3", monitors)).toBeNull();
    expect(previewAspect("default", monitors)).toBeNull();
    expect(previewAspect("nonsense", monitors)).toBeNull();
  });
});
