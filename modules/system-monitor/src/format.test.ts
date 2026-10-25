import { describe, expect, it } from "vitest";
import { degrees, driveTone, megahertz, memory, num, percent, size, speed, temperatureTone, usedPercent, watts } from "./format";

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

describe("temperature", () => {
  it("is written in whole degrees", () => {
    expect(degrees(64)).toBe("64");
    expect(degrees(64.6)).toBe("65");
  });
  it("turns yellow from 80 and red from 90 degrees, and has no colour without a reading", () => {
    expect(temperatureTone(null)).toBe("ok");
    expect(temperatureTone(79)).toBe("ok");
    expect(temperatureTone(80)).toBe("warning");
    expect(temperatureTone(89)).toBe("warning");
    expect(temperatureTone(90)).toBe("danger");
  });
});

describe("power and clock", () => {
  it("write whole watts and megahertz", () => {
    expect(watts(310.4)).toBe("310 W");
    expect(watts(309.6, "de")).toBe("310 W");
    expect(watts(0.4)).toBe("0 W");
    expect(megahertz(1905.2)).toBe("1905 MHz");
  });
});
