import { describe, expect, it } from "vitest";
import { comparePlainVersions, compareVersionsLoose, parsePlainVersion } from "./plain-version";

const MALFORMED = ["", "1", "1.2", "1.2.x", "x.y.z", "1.2.3.4", "01.2.3", "1.02.3", "1.2.03", "1.2.3-beta.1", "1.2.3+build", "v1.2.3", " 1.2.3", "1.2.3 ", "1.2.3\n", "-1.2.3", "1.2.-3", "1..3", "1234567890.0.0", "NaN.NaN.NaN"];

describe("parsePlainVersion", () => {
  it("reads x.y.z", () => {
    expect(parsePlainVersion("0.0.0")).toEqual([0, 0, 0]);
    expect(parsePlainVersion("1.20.300")).toEqual([1, 20, 300]);
    expect(parsePlainVersion("999999999.0.0")).toEqual([999999999, 0, 0]);
  });

  it.each(MALFORMED)("refuses %j", (version) => {
    expect(parsePlainVersion(version)).toBeNull();
  });

  it("refuses what is not a string", () => {
    for (const value of [undefined, null, 1, 1.2, ["1.2.3"], { toString: () => "1.2.3" }]) expect(parsePlainVersion(value)).toBeNull();
  });
});

describe("comparePlainVersions", () => {
  it("orders by number, not by text", () => {
    expect(comparePlainVersions("0.10.0", "0.9.0")).toBe(1);
    expect(comparePlainVersions("0.3.2", "0.3.10")).toBe(-1);
    expect(comparePlainVersions("1.0.0", "0.99.99")).toBe(1);
    expect(comparePlainVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("never gives an order when either side is malformed, in either position", () => {
    for (const bad of MALFORMED) {
      expect(comparePlainVersions(bad, "1.0.0")).toBeNull();
      expect(comparePlainVersions("1.0.0", bad)).toBeNull();
      expect(comparePlainVersions(bad, bad)).toBeNull();
    }
  });
});

describe("compareVersionsLoose", () => {
  it("reads the leading x.y.z and counts anything else as 0.0.0", () => {
    expect(compareVersionsLoose("0.2.11", "0.2.7")).toBe(1);
    expect(compareVersionsLoose("0.2.7", "0.2.11")).toBe(-1);
    expect(compareVersionsLoose("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersionsLoose("nonsense", "0.0.0")).toBe(0);
    expect(compareVersionsLoose("1.2.3-beta.1", "1.2.3")).toBe(0);
    expect(compareVersionsLoose("1.2", "0.0.1")).toBe(-1);
  });
});
