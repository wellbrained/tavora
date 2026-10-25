import { describe, expect, it } from "vitest";
import { driveTone, memory, num, percent, size, speed, usedPercent } from "./format";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe("percent", () => {
  it("has no decimals and stays between 0 and 100", () => {
    expect(percent(41.6)).toBe("42");
    expect(percent(0.2)).toBe("0");
    expect(percent(104)).toBe("100");
    expect(percent(-3)).toBe("0");
  });
});

describe("size", () => {
  it("writes GB, with a decimal under 10, and TB from 1024 GB", () => {
    expect(size(16 * GB)).toBe("16 GB");
    expect(size(7.54 * GB)).toBe("7.5 GB");
    expect(size(120 * GB)).toBe("120 GB");
    expect(size(931 * GB)).toBe("931 GB");
    expect(size(1024 * GB)).toBe("1.0 TB");
    expect(size(2048 * GB)).toBe("2.0 TB");
    expect(size(0)).toBe("0 GB");
  });
  it("follows the language's decimal mark", () => {
    expect(size(7.54 * GB, "de")).toBe("7,5 GB");
  });
});

describe("speed and memory", () => {
  it("writes MB/s", () => {
    expect(speed(0)).toBe("0.0 MB/s");
    expect(speed(3.26 * MB)).toBe("3.3 MB/s");
    expect(speed(120 * MB)).toBe("120 MB/s");
  });
  it("writes Tavora's memory in MB, GB from a gigabyte", () => {
    expect(memory(180 * MB)).toBe("180 MB");
    expect(memory(1.5 * GB)).toBe("1.5 GB");
  });
  it("keeps decimals fixed", () => {
    expect(num(0.4, 1, "en")).toBe("0.4");
    expect(num(0.4, 1, "de")).toBe("0,4");
  });
});

describe("driveTone", () => {
  it("is yellow under 10 % or 20 GB free and red under 5 %", () => {
    expect(driveTone(500 * GB, 1000 * GB)).toBe("ok");
    expect(driveTone(99 * GB, 1000 * GB)).toBe("warning");
    expect(driveTone(49 * GB, 1000 * GB)).toBe("danger");
    expect(driveTone(19 * GB, 300 * GB)).toBe("warning");
    expect(driveTone(30 * GB, 300 * GB)).toBe("ok");
    // 20 GB of 100 GB is 20 %: fine; 4 GB of 100 GB is below 5 %: red.
    expect(driveTone(20 * GB, 100 * GB)).toBe("ok");
    expect(driveTone(4 * GB, 100 * GB)).toBe("danger");
  });
  it("has no colour when the size is unknown", () => {
    expect(driveTone(null, null)).toBe("ok");
    expect(driveTone(5 * GB, null)).toBe("ok");
    expect(driveTone(0, 0)).toBe("ok");
  });
});

describe("usedPercent", () => {
  it("is the share used", () => {
    expect(usedPercent(250, 1000)).toBe(75);
    expect(usedPercent(null, 1000)).toBe(0);
  });
});

describe("speedNumber", () => {
  it("is the number without the unit", async () => {
    const { speedNumber } = await import("./format");
    expect([speedNumber(2.34 * MB), speedNumber(8.2 * MB), speedNumber(120 * MB), speedNumber(3 * MB, "de")]).toEqual(["2.3", "8.2", "120", "3,0"]);
  });
});
