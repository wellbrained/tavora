import { OFFICIAL_OWNER } from "@tavora/module-schema";
import { describe, expect, it } from "vitest";
import { appName, AppsReader, isWindowsProcess, onlySystemMonitor, parseProcesses, SYSTEM_MONITOR_ID, type ProcessEntry } from "./system-apps";

const GB = 1e9;
/** CPU time in 100-nanosecond units for `ms` milliseconds. */
const ms = (value: number) => value * 10_000;
const entry = (pid: number, name: string, privateBytes: number, cpuTime = 0): ProcessEntry => ({ pid, name, privateBytes, cpuTime });

describe("names", () => {
  it("drops .exe and writes the first letter big, leaving the rest", () => {
    expect(appName("firefox.exe")).toBe("Firefox");
    expect(appName("MsMpEng.exe")).toBe("MsMpEng");
    expect(appName("Memory Compression")).toBe("Memory Compression");
  });

  it("knows Windows' own processes", () => {
    expect(isWindowsProcess("svchost.exe")).toBe(true);
    expect(isWindowsProcess("Memory Compression")).toBe(true);
    expect(isWindowsProcess("System")).toBe(true);
    expect(isWindowsProcess("firefox.exe")).toBe(false);
    expect(isWindowsProcess("enshrouded.exe")).toBe(false);
  });
});

describe("AppsReader", () => {
  it("groups processes by name, the biggest first, without Idle", () => {
    const reader = new AppsReader(4);
    const read = reader.read([entry(0, "", 0, ms(9000)), entry(10, "firefox.exe", 4 * GB), entry(11, "Firefox.exe", 2.8 * GB), entry(12, "svchost.exe", 1 * GB), entry(13, "discord.exe", 2 * GB)], 1000, 20 * GB);
    expect(read.usedBytes).toBe(20 * GB);
    expect(read.apps.map((app) => [app.name, app.memoryBytes, app.windows])).toEqual([
      ["Firefox", 6.8 * GB, false],
      ["Discord", 2 * GB, false],
      ["Svchost", 1 * GB, true],
    ]);
  });

  it("has no CPU on the first reading, then a share of the whole PC", () => {
    const reader = new AppsReader(4);
    expect(reader.read([entry(10, "game.exe", GB, 0)], 1000, 0).apps[0]!.cpu).toBeNull();
    // 1 second on 4 threads: 2 s of CPU time is half the PC.
    const read = reader.read([entry(10, "game.exe", GB, ms(2000)), entry(20, "new.exe", GB, ms(500))], 2000, 0);
    expect(read.apps.find((app) => app.name === "Game")!.cpu).toBe(50);
    // A process that started since counts from the next reading.
    expect(read.apps.find((app) => app.name === "New")!.cpu).toBe(0);
    expect(reader.age(2500)).toBe(500);
  });

  it("does not count a reused PID's time as the old process's", () => {
    const reader = new AppsReader(1);
    reader.read([entry(10, "old.exe", GB, ms(100))], 1000, 0);
    const read = reader.read([entry(10, "other.exe", GB, ms(900))], 2000, 0);
    expect(read.apps[0]!.cpu).toBe(0);
  });

  it("caps CPU at 100", () => {
    const reader = new AppsReader(1);
    reader.read([entry(10, "a.exe", GB, 0)], 1000, 0);
    expect(reader.read([entry(10, "a.exe", GB, ms(5000))], 2000, 0).apps[0]!.cpu).toBe(100);
  });
});

describe("parseProcesses", () => {
  /** Builds a SystemProcessInformation buffer the way Windows lays it out on 64-bit, names after each entry. */
  function buffer(base: bigint, list: { pid: number; name: string; privateBytes: number; user: number; kernel: number }[]): Buffer {
    const ENTRY = 256;
    const out = Buffer.alloc(ENTRY * list.length);
    list.forEach((item, index) => {
      const at = index * ENTRY;
      out.writeUInt32LE(index === list.length - 1 ? 0 : ENTRY, at);
      out.writeBigInt64LE(BigInt(item.privateBytes), at + 8);
      out.writeBigInt64LE(BigInt(item.user), at + 40);
      out.writeBigInt64LE(BigInt(item.kernel), at + 48);
      const name = Buffer.from(item.name, "utf16le");
      out.writeUInt16LE(name.length, at + 56);
      out.writeUInt16LE(name.length + 2, at + 58);
      out.writeBigUInt64LE(item.name ? base + BigInt(at + 200) : 0n, at + 64);
      out.writeBigUInt64LE(BigInt(item.pid), at + 80);
      name.copy(out, at + 200);
    });
    return out;
  }

  it("reads pid, name, private memory and CPU time of each entry", () => {
    const base = 0x1_0000_0000n;
    const read = parseProcesses(buffer(base, [
      { pid: 0, name: "", privateBytes: 0, user: 0, kernel: 7 },
      { pid: 4, name: "", privateBytes: 100, user: 0, kernel: 9 },
      { pid: 1234, name: "Föö.exe", privateBytes: 6.8e9, user: 30, kernel: 12 },
    ]), base);
    expect(read).toEqual([
      { pid: 0, name: "", privateBytes: 0, cpuTime: 7 },
      { pid: 4, name: "System", privateBytes: 100, cpuTime: 9 },
      { pid: 1234, name: "Föö.exe", privateBytes: 6.8e9, cpuTime: 42 },
    ]);
  });

  it("leaves out a name that points outside the buffer", () => {
    const list = buffer(0n, [{ pid: 8, name: "x.exe", privateBytes: 1, user: 0, kernel: 0 }]);
    expect(parseProcesses(list, 0x5000n)[0]!.name).toBe("");
  });
});

describe("onlySystemMonitor", () => {
  it("lets only the official System Monitor through", () => {
    expect(() => onlySystemMonitor(OFFICIAL_OWNER, SYSTEM_MONITOR_ID, "systemInfo.apps")).not.toThrow();
    expect(() => onlySystemMonitor(OFFICIAL_OWNER, "tavora.clock-counter", "systemInfo.apps")).toThrow(expect.objectContaining({ code: "PERMISSION_DENIED" }));
    expect(() => onlySystemMonitor("local", SYSTEM_MONITOR_ID, "systemInfo.apps")).toThrow(expect.objectContaining({ code: "PERMISSION_DENIED" }));
  });
});
