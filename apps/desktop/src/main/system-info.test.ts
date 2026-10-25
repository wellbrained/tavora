import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemInfo, SystemSnapshot } from "@tavora/sdk/protocol";
import { NO_PARTS, SystemMonitor, WARM_UP_MS, type ProbeParts, type ProbeSample, type SystemProbe, type TavoraUsage } from "./system-info";
import { parseWatch } from "./system-info-parse";

const INFO: SystemInfo = {
  cpu: { model: "Test CPU", threads: 4 },
  ramBytes: 16e9,
  gpus: [
    { id: "0x00000000_0x0000000a", name: "Big GPU", dedicated: true, vramBytes: 10e9 },
    { id: "0x00000000_0x0000000b", name: "Small GPU", dedicated: false, vramBytes: null },
  ],
  drives: [
    { id: "C:", label: "System", kind: "internal", totalBytes: 1e12 },
    { id: "Z:", label: "", kind: "network", totalBytes: null },
  ],
};

const C = 1 << 2;
const D = 1 << 3;
const Z = 1 << 25;

class FakeProbe implements SystemProbe {
  mask = C | Z;
  infoReads = 0;
  configures: ProbeParts[] = [];
  collects: ProbeParts[] = [];
  closes = 0;
  /** Reads of cpuTotal in turn; the last one repeats. */
  cpu: number[] = [10];
  cores = [10, 20, 30, 40];
  gpu = new Map([["0x00000000_0x0000000a", 55]]);
  vram = new Map([["0x00000000_0x0000000a", 3e9]]);
  io = new Map([["C:", { read: 1000.4, write: 2000.6 }]]);
  spaceReads: string[] = [];
  private cpuAt = 0;
  open: ProbeParts = { ...NO_PARTS };

  info(): SystemInfo {
    this.infoReads++;
    return INFO;
  }
  driveMask(): number {
    return this.mask;
  }
  configure(parts: ProbeParts): boolean {
    this.configures.push({ ...parts });
    const fresh = (Object.keys(parts) as (keyof ProbeParts)[]).some((key) => parts[key] && !this.open[key]);
    this.open = { ...parts };
    return fresh;
  }
  collect(parts: ProbeParts): ProbeSample {
    this.collects.push({ ...parts });
    const sample: ProbeSample = {};
    if (parts.cpuTotal) sample.cpuTotal = this.cpu[Math.min(this.cpuAt++, this.cpu.length - 1)]!;
    if (parts.cpuCores) sample.cpuCores = this.cores;
    if (parts.gpuUsage) sample.gpuUsage = this.gpu;
    if (parts.gpuMemory) sample.gpuMemory = this.vram;
    if (parts.driveIo) sample.driveIo = this.io;
    return sample;
  }
  driveSpace(letter: string) {
    this.spaceReads.push(letter);
    return letter === "C" ? { freeBytes: 400e9, totalBytes: 1e12 } : null;
  }
  close(): void {
    this.closes++;
    this.open = { ...NO_PARTS };
  }
}

let probe: FakeProbe;
let monitor: SystemMonitor;
let tavora: TavoraUsage;

function listener() {
  const snapshots: SystemSnapshot[] = [];
  let drives = 0;
  return { snapshots, get drives() { return drives; }, target: { snapshot: (s: SystemSnapshot) => void snapshots.push(s), drivesChanged: () => void drives++ } };
}

function watching(blocks: object, intervalMs: 1000 | 2000 | 5000 | 15000 | 60000 = 1000) {
  const received = listener();
  const subscription = monitor.subscribe(received.target);
  subscription.watch(parseWatch({ blocks, intervalMs }));
  return Object.assign(received, { subscription, watch: (more: object, interval = intervalMs) => subscription.watch(parseWatch({ blocks: more, intervalMs: interval })) });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  probe = new FakeProbe();
  tavora = { cpu: 1.26, memoryBytes: 300e6 };
  monitor = new SystemMonitor({ probe, tavora: () => tavora });
});

afterEach(() => {
  monitor.dispose();
  vi.useRealTimers();
});

describe("what runs", () => {
  it("has no timer and no counters until a panel watches", () => {
    expect(monitor.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    monitor.subscribe(listener().target);
    expect(monitor.running).toBe(false);
    expect(probe.configures).toEqual([]);
  });

  it("stops everything when the last panel stops watching or goes", () => {
    const a = watching({ cpu: true });
    const b = watching({ ram: true });
    expect(monitor.running).toBe(true);
    a.watch({});
    expect(monitor.running).toBe(true);
    b.subscription.close();
    expect(monitor.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(probe.open).toEqual(NO_PARTS);
  });

  it("opens only the counters somebody watches, as the union of the panels", () => {
    watching({ cpu: true });
    expect(probe.configures.at(-1)).toEqual({ cpuTotal: true, cpuCores: true, gpuUsage: false, gpuMemory: false, driveIo: false });
    watching({ gpu: true, drives: ["C:"] });
    expect(probe.configures.at(-1)).toEqual({ cpuTotal: true, cpuCores: true, gpuUsage: true, gpuMemory: true, driveIo: true });
    watching({ ram: true });
    // RAM and Tavora come from Node and Electron, no counter.
    expect(probe.configures).toHaveLength(2);
  });

  it("closes counters nobody needs any more", () => {
    const a = watching({ cpu: true });
    const b = watching({ gpu: true });
    a.subscription.close();
    expect(probe.configures.at(-1)).toMatchObject({ cpuTotal: false, gpuUsage: true });
    b.watch({ ram: true });
    expect(probe.configures.at(-1)).toEqual(NO_PARTS);
  });
});

describe("snapshots", () => {
  it("sends the first one right after the counters warmed up, then each interval", () => {
    const w = watching({ cpu: true });
    expect(w.snapshots).toHaveLength(0);
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(w.snapshots).toHaveLength(1);
    expect(w.snapshots[0]).toMatchObject({ intervalMs: 1000, cpu: { usage: 10, peak: 10, cores: [10, 20, 30, 40] } });
    vi.advanceTimersByTime(1000);
    expect(w.snapshots).toHaveLength(2);
    vi.advanceTimersByTime(3000);
    expect(w.snapshots).toHaveLength(5);
  });

  it("sends the first one at once when the counters were open already", () => {
    const first = watching({ cpu: true });
    vi.advanceTimersByTime(1500);
    const second = watching({ cpu: true });
    vi.advanceTimersByTime(0);
    expect(second.snapshots).toHaveLength(1);
    expect(first.snapshots.length).toBeGreaterThanOrEqual(1);
  });

  it("carries only the blocks the panel asked for", () => {
    const a = watching({ cpu: true });
    const b = watching({ ram: true, tavora: true });
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(Object.keys(a.snapshots[0]!).sort()).toEqual(["at", "cpu", "intervalMs"]);
    expect(Object.keys(b.snapshots[0]!).sort()).toEqual(["at", "intervalMs", "ram", "tavora"]);
    expect(b.snapshots[0]!.tavora).toEqual({ cpu: 1.3, memoryBytes: 300e6 });
    expect(b.snapshots[0]!.ram!.usedBytes).toBeGreaterThanOrEqual(0);
    expect(b.snapshots[0]!.ram!.totalBytes).toBeGreaterThan(0);
  });

  it("reports each graphics card with its usage and video memory", () => {
    const w = watching({ gpu: true });
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(w.snapshots[0]!.gpus).toEqual([
      { id: "0x00000000_0x0000000a", usage: 55, peak: 55, vramUsedBytes: 3e9 },
      { id: "0x00000000_0x0000000b", usage: 0, peak: 0, vramUsedBytes: null },
    ]);
  });

  it("reports drives in the order asked, with free space, speeds and gone drives", () => {
    const w = watching({ drives: ["D:", "C:", "Z:"] });
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(w.snapshots[0]!.drives).toEqual([
      { id: "D:", connected: false, freeBytes: null, totalBytes: null, readBytesPerSec: 0, writeBytesPerSec: 0 },
      { id: "C:", connected: true, freeBytes: 400e9, totalBytes: 1e12, readBytesPerSec: 1000, writeBytesPerSec: 2001 },
      // A network drive is never asked for its space: it could hang.
      { id: "Z:", connected: true, freeBytes: null, totalBytes: null, readBytesPerSec: 0, writeBytesPerSec: 0 },
    ]);
    expect(probe.spaceReads).toEqual(["C"]);
  });

  it("averages the readings since the last snapshot, with one decimal", () => {
    probe.cpu = [10, 20, 33.33];
    const w = watching({ cpu: true }, 2000);
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(w.snapshots[0]!.cpu!.usage).toBe(10);
    vi.advanceTimersByTime(2000);
    expect(w.snapshots[1]!.cpu!.usage).toBe(20);
  });

  it("leaves out a block that could not be read", () => {
    probe.cpu = [];
    probe.collect = () => ({});
    const w = watching({ cpu: true, ram: true });
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(w.snapshots[0]!.cpu).toBeUndefined();
    expect(w.snapshots[0]!.ram).toBeDefined();
  });

  it("keeps going when a panel can't be told or the probe throws", () => {
    const log = vi.fn();
    monitor = new SystemMonitor({ probe, tavora: () => tavora, log });
    const bad = monitor.subscribe({ snapshot: () => { throw new Error("port closed"); }, drivesChanged: () => undefined });
    bad.watch(parseWatch({ blocks: { ram: true }, intervalMs: 1000 }));
    const good = watching({ ram: true });
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(good.snapshots).toHaveLength(1);
    const real = probe.collect.bind(probe);
    probe.collect = () => { throw new Error("pdh"); };
    vi.advanceTimersByTime(1000);
    probe.collect = real;
    vi.advanceTimersByTime(1000);
    expect(good.snapshots.length).toBeGreaterThanOrEqual(2);
    expect(log).toHaveBeenCalled();
  });
});

describe("panels with different intervals", () => {
  it("gives each its own rhythm from one reader", () => {
    const fast = watching({ cpu: true }, 1000);
    const slow = watching({ cpu: true }, 5000);
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(fast.snapshots).toHaveLength(1);
    expect(slow.snapshots).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(fast.snapshots.length).toBeGreaterThanOrEqual(5);
    expect(slow.snapshots).toHaveLength(2);
  });

  it("filters by panel", () => {
    const a = watching({ cpu: true });
    const b = watching({ ram: true });
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(a.snapshots[0]!.ram).toBeUndefined();
    expect(b.snapshots[0]!.cpu).toBeUndefined();
  });

  it("reads cores, video memory and drive speeds only when a panel is due for them", () => {
    const w = watching({ cpu: true, gpu: true, drives: ["C:"] }, 60000);
    vi.advanceTimersByTime(WARM_UP_MS);
    probe.collects.length = 0;
    vi.advanceTimersByTime(5000);
    expect(w.snapshots).toHaveLength(1);
    expect(probe.collects.length).toBe(5);
    for (const parts of probe.collects) expect(parts).toEqual({ cpuTotal: true, cpuCores: false, gpuUsage: true, gpuMemory: false, driveIo: false });
  });
});

describe("peak", () => {
  it("is the busiest second for intervals from 5 seconds, looking each second", () => {
    probe.cpu = [10, 90, 20, 10, 10, 10, 10];
    probe.gpu = new Map([["0x00000000_0x0000000a", 10]]);
    const w = watching({ cpu: true }, 5000);
    vi.advanceTimersByTime(WARM_UP_MS);
    probe.cpu = [10, 90, 20, 10, 10];
    // The warm-up look read 10; the next five seconds read 10, 90, 20, 10, 10.
    vi.advanceTimersByTime(5000);
    const second = w.snapshots[1]!;
    expect(second.cpu!.peak).toBeGreaterThanOrEqual(second.cpu!.usage);
    expect(second.cpu!.peak).toBe(90);
    expect(second.cpu!.usage).toBe(28);
  });

  it("takes the busiest second for a graphics card too", () => {
    let busy = 5;
    probe.collect = (parts) => ({ ...(parts.gpuUsage ? { gpuUsage: new Map([["0x00000000_0x0000000a", (busy += 10)]]) } : {}) });
    const w = watching({ gpu: true }, 5000);
    vi.advanceTimersByTime(WARM_UP_MS + 5000);
    const last = w.snapshots.at(-1)!.gpus![0]!;
    expect(last.peak).toBeGreaterThan(last.usage);
  });

  it("equals the usage under 5 seconds", () => {
    probe.cpu = [10, 90, 30];
    const w = watching({ cpu: true }, 2000);
    vi.advanceTimersByTime(WARM_UP_MS + 2000);
    for (const snapshot of w.snapshots) expect(snapshot.cpu!.peak).toBe(snapshot.cpu!.usage);
  });
});

describe("suspend and resume", () => {
  it("stops the timer and the counters while the only panel is hidden", () => {
    const w = watching({ cpu: true });
    vi.advanceTimersByTime(WARM_UP_MS);
    w.subscription.setSuspended(true);
    expect(monitor.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const before = w.snapshots.length;
    vi.advanceTimersByTime(10_000);
    expect(w.snapshots).toHaveLength(before);
  });

  it("keeps reading for the other panel", () => {
    const hidden = watching({ cpu: true });
    const shown = watching({ cpu: true });
    vi.advanceTimersByTime(WARM_UP_MS);
    hidden.subscription.setSuspended(true);
    const before = hidden.snapshots.length;
    vi.advanceTimersByTime(3000);
    expect(hidden.snapshots).toHaveLength(before);
    expect(shown.snapshots.length).toBeGreaterThanOrEqual(3);
  });

  it("sends a snapshot at once on resume", () => {
    const w = watching({ cpu: true }, 60000);
    vi.advanceTimersByTime(WARM_UP_MS);
    w.subscription.setSuspended(true);
    vi.advanceTimersByTime(30_000);
    const before = w.snapshots.length;
    w.subscription.setSuspended(false);
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(w.snapshots).toHaveLength(before + 1);
  });

  it("counts a panel that is hidden before it watches as hidden", () => {
    const received = listener();
    const subscription = monitor.subscribe(received.target);
    subscription.setSuspended(true);
    subscription.watch(parseWatch({ blocks: { cpu: true }, intervalMs: 1000 }));
    expect(monitor.running).toBe(false);
    subscription.setSuspended(false);
    expect(monitor.running).toBe(true);
  });

  it("does not let a hidden panel's averages carry over", () => {
    probe.cpu = [90];
    const w = watching({ cpu: true }, 5000);
    vi.advanceTimersByTime(WARM_UP_MS);
    w.subscription.setSuspended(true);
    probe.cpu = [10];
    w.subscription.setSuspended(false);
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(w.snapshots.at(-1)!.cpu).toMatchObject({ usage: 10, peak: 10 });
  });
});

describe("closing and revoking", () => {
  it("sends nothing after the panel closed", () => {
    const w = watching({ cpu: true });
    vi.advanceTimersByTime(WARM_UP_MS);
    w.subscription.close();
    const before = w.snapshots.length;
    vi.advanceTimersByTime(5000);
    expect(w.snapshots).toHaveLength(before);
    expect(monitor.running).toBe(false);
    // A closed subscription can't be brought back.
    w.watch({ cpu: true });
    expect(monitor.running).toBe(false);
  });

  it("stops at once when a panel stops watching", () => {
    const w = watching({ cpu: true });
    vi.advanceTimersByTime(WARM_UP_MS);
    w.watch({});
    expect(monitor.running).toBe(false);
  });

  it("takes a new watch as replacing the old one and sends a snapshot for it", () => {
    const w = watching({ cpu: true }, 60000);
    vi.advanceTimersByTime(WARM_UP_MS);
    const before = w.snapshots.length;
    w.watch({ ram: true }, 60000);
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(w.snapshots).toHaveLength(before + 1);
    expect(w.snapshots.at(-1)!.cpu).toBeUndefined();
    expect(w.snapshots.at(-1)!.ram).toBeDefined();
  });

  it("stops everything on dispose", () => {
    watching({ cpu: true });
    watching({ ram: true });
    monitor.dispose();
    expect(monitor.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("drives", () => {
  it("reads the hardware once and keeps it", () => {
    expect(monitor.info()).toBe(INFO);
    monitor.info();
    expect(probe.infoReads).toBe(1);
  });

  it("tells watching panels when the drive letters change and reads the hardware again", () => {
    monitor.info();
    const w = watching({ ram: true });
    const other = watching({ cpu: true });
    vi.advanceTimersByTime(WARM_UP_MS + 1000);
    expect(w.drives).toBe(0);
    probe.mask |= D;
    vi.advanceTimersByTime(1000);
    expect(w.drives).toBe(1);
    expect(other.drives).toBe(1);
    expect(probe.infoReads).toBe(1);
    monitor.info();
    expect(probe.infoReads).toBe(2);
    vi.advanceTimersByTime(3000);
    expect(w.drives).toBe(1);
  });

  it("notices a change even when nothing watched meanwhile", () => {
    monitor.info();
    probe.mask |= D;
    monitor.info();
    expect(probe.infoReads).toBe(2);
  });

  it("tells the panel when a watched drive goes away", () => {
    const w = watching({ drives: ["C:"] });
    vi.advanceTimersByTime(WARM_UP_MS);
    expect(w.snapshots[0]!.drives![0]).toMatchObject({ connected: true });
    probe.mask &= ~C;
    vi.advanceTimersByTime(1000);
    expect(w.snapshots.at(-1)!.drives![0]).toEqual({ id: "C:", connected: false, freeBytes: null, totalBytes: null, readBytesPerSec: 0, writeBytesPerSec: 0 });
    expect(w.drives).toBe(1);
  });
});

describe("a PC without Windows' counters", () => {
  it("still answers with what it can", () => {
    const bare: SystemProbe = { info: () => ({ ...INFO, gpus: [], drives: [] }), driveMask: () => 0, configure: () => false, collect: () => ({}), driveSpace: () => null, close: () => undefined };
    monitor = new SystemMonitor({ probe: bare, tavora: () => tavora });
    const received = listener();
    monitor.subscribe(received.target).watch(parseWatch({ blocks: { cpu: true, gpu: true, ram: true, drives: ["C:"] }, intervalMs: 1000 }));
    vi.advanceTimersByTime(0);
    expect(received.snapshots).toHaveLength(1);
    expect(received.snapshots[0]!.cpu).toBeUndefined();
    expect(received.snapshots[0]!.gpus).toBeUndefined();
    expect(received.snapshots[0]!.ram).toBeDefined();
    expect(received.snapshots[0]!.drives![0]!.connected).toBe(false);
  });
});
