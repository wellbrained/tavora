import { describe, expect, it } from "vitest";
import { formatClock, formatInput, formatNumber, formatPower, formatRate } from "./format";

describe("format", () => {
  it("drops trailing zeros and noise", () => {
    expect(formatNumber(2.5, "en-GB")).toBe("2.5");
    expect(formatNumber(3, "en-GB")).toBe("3");
    expect(formatNumber(-1e-12, "en-GB")).toBe("0");
    expect(formatRate(12.3456, "de-DE")).toBe("12,35");
  });

  it("shows clock speeds with up to 4 decimals", () => {
    expect(formatClock(83.33333, "en-GB")).toBe("83.3333 %");
    expect(formatClock(100, "de-DE")).toBe("100 %");
  });

  it("shows MW below 1000 and GW from there", () => {
    expect(formatPower(4, "en-GB")).toBe("4 MW");
    expect(formatPower(1234.5, "en-GB")).toBe("1.23 GW");
  });

  it("writes text-field numbers without thousands separators", () => {
    expect(formatInput(1234.5, "de-DE")).toBe("1234,5");
    expect(formatInput(1234.5, "en-GB")).toBe("1234.5");
  });
});
