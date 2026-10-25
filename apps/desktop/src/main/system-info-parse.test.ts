import { describe, expect, it } from "vitest";
import { HostError } from "./errors";
import { coresInOrder, gpuMemoryByAdapter, gpuUsageByAdapter, isEmptyWatch, luidId, luidOf, parseWatch, percent } from "./system-info-parse";

const refused = (params: unknown) => {
  try {
    parseWatch(params);
  } catch (error) {
    expect(error).toBeInstanceOf(HostError);
    expect((error as HostError).code).toBe("INVALID_PARAMS");
    return true;
  }
  return false;
};

describe("parseWatch", () => {
  it("fills in every part and drops repeated drives", () => {
    expect(parseWatch({ blocks: { cpu: true, drives: ["C:", "D:", "C:"] }, intervalMs: 2000 })).toEqual({
      blocks: { cpu: true, gpu: false, ram: false, drives: ["C:", "D:"], tavora: false },
      intervalMs: 2000,
    });
  });

  it.each([1000, 2000, 5000, 15000, 60000])("takes %i ms", (intervalMs) => {
    expect(parseWatch({ blocks: {}, intervalMs }).intervalMs).toBe(intervalMs);
  });

  it.each([0, 500, 3000, "1000", null, undefined, 1000.5])("refuses the interval %j", (intervalMs) => {
    expect(refused({ blocks: { cpu: true }, intervalMs })).toBe(true);
  });

  it.each([
    undefined,
    null,
    [],
    "cpu",
    { intervalMs: 1000 },
    { blocks: null, intervalMs: 1000 },
    { blocks: [], intervalMs: 1000 },
    { blocks: { cpu: "yes" }, intervalMs: 1000 },
    { blocks: { cpu: 1 }, intervalMs: 1000 },
    { blocks: { fan: true }, intervalMs: 1000 },
    { blocks: { drives: "C:" }, intervalMs: 1000 },
    { blocks: { drives: ["C"] }, intervalMs: 1000 },
    { blocks: { drives: ["c:"] }, intervalMs: 1000 },
    { blocks: { drives: ["C:\\"] }, intervalMs: 1000 },
    { blocks: { drives: [7] }, intervalMs: 1000 },
    { blocks: {}, intervalMs: 1000, more: true },
  ])("refuses %j", (params) => {
    expect(refused(params)).toBe(true);
  });

  it("takes up to 26 drives and refuses more, even when they repeat", () => {
    const letters = Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:`);
    expect(parseWatch({ blocks: { drives: letters }, intervalMs: 1000 }).blocks.drives).toHaveLength(26);
    expect(refused({ blocks: { drives: [...letters, "A:"] }, intervalMs: 1000 })).toBe(true);
  });

  it("knows when nothing is watched", () => {
    expect(isEmptyWatch(parseWatch({ blocks: {}, intervalMs: 1000 }).blocks)).toBe(true);
    expect(isEmptyWatch(parseWatch({ blocks: { drives: [] }, intervalMs: 1000 }).blocks)).toBe(true);
    expect(isEmptyWatch(parseWatch({ blocks: { drives: ["C:"] }, intervalMs: 1000 }).blocks)).toBe(false);
    expect(isEmptyWatch(parseWatch({ blocks: { tavora: true }, intervalMs: 1000 }).blocks)).toBe(false);
  });
});

describe("percent", () => {
  it("keeps 0 to 100 with one decimal", () => {
    expect(percent(12.345)).toBe(12.3);
    expect(percent(-4)).toBe(0);
    expect(percent(180)).toBe(100);
    expect(percent(Number.NaN)).toBe(0);
    expect(percent(Infinity)).toBe(0);
  });
});

describe("luid", () => {
  it("reads the id out of counter names, whatever the case", () => {
    expect(luidOf("pid_10360_luid_0x00000000_0x0001DEFC_phys_0_eng_0_engtype_3D")).toBe("0x00000000_0x0001defc");
    expect(luidOf("luid_0x00000000_0x000228A2_phys_0")).toBe("0x00000000_0x000228a2");
    expect(luidOf("C:")).toBeNull();
  });

  it("writes an adapter's LUID the same way", () => {
    expect(luidId(0, 0x1defc)).toBe("0x00000000_0x0001defc");
    expect(luidId(-1, 0xffffffff)).toBe("0xffffffff_0xffffffff");
  });
});

describe("gpuUsageByAdapter", () => {
  const A = "luid_0x00000000_0x0001DEFC_phys_0";
  const B = "luid_0x00000000_0x000228A2_phys_0";
  const engine = (luid: string, pid: number, engine: number, type: string, value: number) => ({ name: `pid_${pid}_${luid}_eng_${engine}_engtype_${type}`, value });

  it("adds the processes of one kind of engine and takes the busiest kind", () => {
    const usage = gpuUsageByAdapter([
      engine(A, 1, 0, "3D", 20),
      engine(A, 2, 0, "3D", 30),
      engine(A, 1, 1, "Copy", 40),
      engine(A, 3, 5, "VideoDecode", 10),
      engine(B, 1, 0, "3D", 5),
    ]);
    // 3D: 20 + 30 = 50 beats Copy 40 and VideoDecode 10.
    expect(usage.get("0x00000000_0x0001defc")).toBe(50);
    expect(usage.get("0x00000000_0x000228a2")).toBe(5);
  });

  it("adds several engines of one kind together, and caps at 100", () => {
    const usage = gpuUsageByAdapter([engine(A, 1, 0, "3D", 70), engine(A, 2, 0, "3D", 60), engine(A, 3, 1, "3D", 20)]);
    expect(usage.get("0x00000000_0x0001defc")).toBe(100);
  });

  it("ignores names without an adapter and values that aren't numbers", () => {
    const usage = gpuUsageByAdapter([{ name: "something_else", value: 50 }, engine(A, 1, 0, "3D", Number.NaN), engine(A, 2, 0, "Copy", 7)]);
    expect([...usage.keys()]).toEqual(["0x00000000_0x0001defc"]);
    expect(usage.get("0x00000000_0x0001defc")).toBe(7);
  });

  it("is empty without engines", () => {
    expect(gpuUsageByAdapter([]).size).toBe(0);
  });
});

describe("gpuMemoryByAdapter", () => {
  it("gives the bytes in use for each adapter", () => {
    const memory = gpuMemoryByAdapter([
      { name: "luid_0x00000000_0x0001DEFC_phys_0", value: 2205892608 },
      { name: "luid_0x00000000_0x000228A2_phys_0", value: 0 },
    ]);
    expect(memory.get("0x00000000_0x0001defc")).toBe(2205892608);
    expect(memory.get("0x00000000_0x000228a2")).toBe(0);
  });
});

describe("coresInOrder", () => {
  it("sorts by group then number and leaves the totals out", () => {
    const cores = coresInOrder([
      { name: "0,10", value: 10 },
      { name: "_Total", value: 99 },
      { name: "0,2", value: 2 },
      { name: "1,0", value: 100 },
      { name: "0,_Total", value: 98 },
      { name: "0,0", value: 0 },
    ]);
    expect(cores).toEqual([0, 2, 10, 100]);
  });
});
