/**
 * The system-info connector: this PC's hardware and how busy it is, for modules the player granted it. One
 * SystemMonitor serves every panel, in a worker thread of its own (system-info-thread.ts) so a slow look never holds
 * up Tavora. It reads the PC only while at least one panel that is shown watches something; with none there is no
 * timer and no open counter, so it costs nothing. Counters are opened only for the parts somebody watches. The
 * reading itself is a SystemProbe (system-info-windows.ts reads Windows' own counters and NVIDIA's nvml.dll inside
 * Tavora's process; tests use a fake one). Nothing is run, nothing leaves the PC, and a module gets numbers and
 * names only.
 */
import os from "node:os";
import type { SystemConnection, SystemInfo, SystemSnapshot } from "@tavora/sdk/protocol";
import type { ConnectionSource } from "./connection";
import { isEmptyWatch, percent, type WatchBlocks, type WatchRequest } from "./system-info-parse";

/** Which Windows counters to read in one go: each is its own query, so a part nobody needs costs nothing. */
export interface ProbeParts {
  cpuTotal: boolean;
  cpuCores: boolean;
  gpuUsage: boolean;
  gpuMemory: boolean;
  driveIo: boolean;
}

export const NO_PARTS: ProbeParts = { cpuTotal: false, cpuCores: false, gpuUsage: false, gpuMemory: false, driveIo: false };

/** What one collect found. A part that is missing could not be read this time. */
export interface ProbeSample {
  /** The whole PC, 0 to 100. */
  cpuTotal?: number;
  /** Each logical processor in order, 0 to 100. */
  cpuCores?: number[];
  /** Per graphics card id, 0 to 100. */
  gpuUsage?: Map<string, number>;
  /** Per graphics card id, bytes of its own video memory in use. */
  gpuMemory?: Map<string, number>;
  /** Per graphics card id, what only NVIDIA's library tells (nvml.dll); a value is null when that call failed. */
  gpuSensors?: Map<string, { temperatureC: number | null; clockMhz: number | null; powerW: number | null }>;
  /** Per drive id ("C:"), bytes per second. */
  driveIo?: Map<string, { read: number; write: number }>;
}

/** What the reader needs from the PC. Throws are caught by the monitor, which then reports less. */
export interface SystemProbe {
  /** What this PC is. Called when the monitor has no copy (the first time, and after the drives changed). */
  info(): SystemInfo;
  /** The drive letters now as a bit mask (GetLogicalDrives): bit 0 is A:. Cheap. */
  driveMask(): number;
  /**
   * Opens the counters for these parts and closes the others, and reads the new ones once (a rate needs two reads).
   * Returns whether any counter was just opened, which then needs a moment before its first real reading.
   */
  configure(parts: ProbeParts): boolean;
  /** Reads the parts that are open and asked for. */
  collect(parts: ProbeParts): ProbeSample;
  /** Free and total bytes of a local drive, or null when it has no disk in it. */
  driveSpace(letter: string): { freeBytes: number; totalBytes: number } | null;
  /** Closes everything. */
  close(): void;
}

/** Tavora's own use: `cpu` as a share of the whole PC (0 to 100). */
export interface TavoraUsage {
  cpu: number;
  memoryBytes: number;
}

/** What a panel's connection receives. */
export interface SystemListener {
  snapshot(snapshot: SystemSnapshot): void;
  drivesChanged(): void;
  /** The connection went down, changed kind or came back (connection.ts); only for a panel that watches it. */
  connectionChanged?(connection: SystemConnection): void;
}

/** One panel's hold on the monitor. */
export interface SystemSubscription {
  /** Replaces what the panel watches; empty blocks stop it. A first snapshot follows at once. */
  watch(request: WatchRequest): void;
  /** A hidden, minimized or covered panel gets no snapshots and keeps nothing running. Resuming sends one at once. */
  setSuspended(suspended: boolean): void;
  /** Ends the panel's watch for good. */
  close(): void;
}

export interface SystemMonitorOptions {
  probe: SystemProbe;
  tavora: () => TavoraUsage;
  /** The connection watcher (connection.ts), which runs on its own; panels only read what it found. */
  connection?: ConnectionSource;
  /** For tests. */
  now?: () => number;
  /** For problems; the monitor never throws out of a timer. */
  log?: (message: string, error: unknown) => void;
}

/** How long a counter that was just opened needs before its first reading means something. */
export const WARM_UP_MS = 250;
/** A look at the PC each second is what finds the busiest second for panels that want a snapshot rarely. */
const PEAK_TICK_MS = 1000;
/** Intervals from this one on report the busiest second as `peak`. */
const PEAK_FROM_MS = 5000;

interface Subscription extends SystemSubscription {
  request: WatchRequest | null;
  suspended: boolean;
  closed: boolean;
  /** Waiting for its first snapshot since watching started or resumed. */
  first: boolean;
  lastAt: number;
  cpu: Accumulator;
  gpu: Map<string, Accumulator>;
  listener: SystemListener;
}

/** The readings since a panel's last snapshot. */
interface Accumulator {
  sum: number;
  count: number;
  peak: number;
}

function accumulate(into: Accumulator, value: number): void {
  into.sum += value;
  into.count += 1;
  if (value > into.peak) into.peak = value;
}

const clear = (): Accumulator => ({ sum: 0, count: 0, peak: 0 });

/** The parts a set of watches needs. Cores, memory and drive speeds only when a panel is due for a snapshot. */
function partsFor(subscriptions: readonly Subscription[], due: readonly Subscription[]): ProbeParts {
  const parts = { ...NO_PARTS };
  for (const { request } of subscriptions) {
    if (!request) continue;
    if (request.blocks.cpu) parts.cpuTotal = true;
    if (request.blocks.gpu) parts.gpuUsage = true;
  }
  for (const { request } of due) {
    if (!request) continue;
    if (request.blocks.cpu) parts.cpuCores = true;
    if (request.blocks.gpu) parts.gpuMemory = true;
    if (request.blocks.drives.length) parts.driveIo = true;
  }
  return parts;
}

/** What the open counters must cover for these watches, whenever a panel may become due. */
function openPartsFor(subscriptions: readonly Subscription[]): ProbeParts {
  return partsFor(subscriptions, subscriptions);
}

const sameParts = (a: ProbeParts, b: ProbeParts): boolean => (Object.keys(a) as (keyof ProbeParts)[]).every((key) => a[key] === b[key]);

export class SystemMonitor {
  private readonly probe: SystemProbe;
  private readonly tavora: () => TavoraUsage;
  private readonly connection: ConnectionSource | undefined;
  private readonly now: () => number;
  private readonly log: (message: string, error: unknown) => void;
  private readonly subscriptions = new Set<Subscription>();
  private cached: SystemInfo | null = null;
  private mask: number | null = null;
  private open: ProbeParts = NO_PARTS;
  private openedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private period = 0;
  private firstTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SystemMonitorOptions) {
    this.probe = options.probe;
    this.tavora = options.tavora;
    this.connection = options.connection;
    // The watcher runs whether or not a panel is shown; only panels that are shown and watch it are told.
    this.connection?.onChange((reading) => {
      for (const subscription of this.active()) {
        if (subscription.request?.blocks.connection) this.deliver(subscription, () => subscription.listener.connectionChanged?.(reading));
      }
    });
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
  }

  /** What this PC is. Read once and kept; read again when the drives changed. */
  info(): SystemInfo {
    // A drive plugged in while nothing watched is found here, as a tick would find it.
    if (this.cached && this.mask !== null && this.safeMask() !== this.mask) this.cached = null;
    if (!this.cached) {
      this.mask = this.safeMask();
      this.cached = this.probe.info();
    }
    return this.cached;
  }

  /** A panel's connection. It watches nothing until `watch` is called. */
  subscribe(listener: SystemListener): SystemSubscription {
    const subscription: Subscription = {
      request: null,
      suspended: false,
      closed: false,
      first: false,
      lastAt: 0,
      cpu: clear(),
      gpu: new Map(),
      listener,
      watch: (request) => {
        if (subscription.closed) return;
        subscription.request = isEmptyWatch(request.blocks) ? null : request;
        subscription.first = subscription.request !== null;
        subscription.cpu = clear();
        subscription.gpu = new Map();
        subscription.lastAt = this.now();
        this.refresh();
      },
      setSuspended: (suspended) => {
        if (subscription.closed || subscription.suspended === suspended) return;
        subscription.suspended = suspended;
        // Coming back shows the PC now, not what it was while the panel was away.
        subscription.first = !suspended && subscription.request !== null;
        subscription.cpu = clear();
        subscription.gpu = new Map();
        subscription.lastAt = this.now();
        this.refresh();
      },
      close: () => {
        if (subscription.closed) return;
        subscription.closed = true;
        subscription.request = null;
        this.subscriptions.delete(subscription);
        this.refresh();
      },
    };
    this.subscriptions.add(subscription);
    return subscription;
  }

  /** Whether the monitor has a timer or open counters, which is only so while a shown panel watches. */
  get running(): boolean {
    return this.timer !== null || this.firstTimer !== null || this.probeOpen;
  }

  private get probeOpen(): boolean {
    return (Object.values(this.open) as boolean[]).some(Boolean);
  }

  /** Stops everything; the monitor stays usable. */
  dispose(): void {
    for (const subscription of [...this.subscriptions]) subscription.close();
    this.refresh();
  }

  private active(): Subscription[] {
    return [...this.subscriptions].filter((subscription) => !subscription.closed && !subscription.suspended && subscription.request !== null);
  }

  /** Brings the timer and the open counters in line with who watches what, after any change. */
  private refresh(): void {
    const active = this.active();
    if (active.length === 0) {
      this.stopTimers();
      this.closeProbe();
      return;
    }
    try {
      const wanted = openPartsFor(active);
      if (!sameParts(wanted, this.open)) {
        const fresh = this.probe.configure(wanted);
        this.open = wanted;
        if (fresh) this.openedAt = this.now();
      }
    } catch (error) {
      this.log("system-info: could not open the counters", error);
    }
    const period = this.periodFor(active);
    if (this.timer === null || period !== this.period) {
      if (this.timer !== null) clearInterval(this.timer);
      this.period = period;
      this.timer = setInterval(() => this.tick(), period);
      this.timer.unref?.();
    }
    if (active.some((subscription) => subscription.first)) this.scheduleFirst();
  }

  /** How often to look: the shortest interval asked for, but each second when a rare panel wants the busiest second. */
  private periodFor(active: readonly Subscription[]): number {
    let period = Infinity;
    let wantsPeak = false;
    for (const { request } of active) {
      if (!request) continue;
      period = Math.min(period, request.intervalMs);
      if (request.intervalMs >= PEAK_FROM_MS && (request.blocks.cpu || request.blocks.gpu)) wantsPeak = true;
    }
    return wantsPeak ? Math.min(period, PEAK_TICK_MS) : period;
  }

  /** The first snapshot of a new or resumed watch waits only until the counters mean something. */
  private scheduleFirst(): void {
    if (this.firstTimer !== null) return;
    const wait = Math.max(0, WARM_UP_MS - (this.now() - this.openedAt));
    this.firstTimer = setTimeout(() => {
      this.firstTimer = null;
      this.tick(true);
    }, wait);
    this.firstTimer.unref?.();
  }

  private stopTimers(): void {
    if (this.timer !== null) clearInterval(this.timer);
    if (this.firstTimer !== null) clearTimeout(this.firstTimer);
    this.timer = null;
    this.firstTimer = null;
    this.period = 0;
  }

  private closeProbe(): void {
    if (!this.probeOpen) return;
    this.open = NO_PARTS;
    try {
      this.probe.close();
    } catch (error) {
      this.log("system-info: could not close the counters", error);
    }
  }

  private safeMask(): number | null {
    try {
      return this.probe.driveMask();
    } catch {
      return null;
    }
  }

  /** One look at the PC. `onlyFirst`: just the panels waiting for their first snapshot. */
  private tick(onlyFirst = false): void {
    try {
      this.look(onlyFirst);
    } catch (error) {
      this.log("system-info: a look at the PC failed", error);
    }
  }

  private look(onlyFirst: boolean): void {
    const active = this.active();
    if (active.length === 0) return;
    const now = this.now();
    const tolerance = this.period / 2;
    const due = active.filter((subscription) => subscription.first || (!onlyFirst && now - subscription.lastAt + tolerance >= subscription.request!.intervalMs));
    if (onlyFirst && due.length === 0) return;

    const mask = this.safeMask();
    if (mask !== null && this.mask !== null && mask !== this.mask) {
      this.cached = null;
      for (const subscription of active) this.deliver(subscription, () => subscription.listener.drivesChanged());
    }
    if (mask !== null) this.mask = mask;

    const parts = partsFor(onlyFirst ? due : active, due);
    let sample: ProbeSample = {};
    try {
      sample = this.probe.collect(parts);
    } catch (error) {
      this.log("system-info: could not read the counters", error);
    }
    // A single look feeds every panel's average, whether or not it is due now.
    for (const subscription of active) {
      const blocks = subscription.request!.blocks;
      if (blocks.cpu && sample.cpuTotal !== undefined) accumulate(subscription.cpu, sample.cpuTotal);
      if (blocks.gpu && sample.gpuUsage) {
        for (const [id, usage] of sample.gpuUsage) {
          const readings = subscription.gpu.get(id) ?? clear();
          accumulate(readings, usage);
          subscription.gpu.set(id, readings);
        }
      }
    }
    const tavora = due.some((subscription) => subscription.request!.blocks.tavora) ? this.readTavora() : null;
    for (const subscription of due) {
      if (subscription.closed || subscription.suspended || !subscription.request) continue;
      const snapshot = this.snapshotFor(subscription, sample, tavora, now);
      subscription.first = false;
      subscription.lastAt = now;
      subscription.cpu = clear();
      subscription.gpu = new Map();
      this.deliver(subscription, () => subscription.listener.snapshot(snapshot));
    }
  }

  /** A listener that throws must not stop the others or the timer. */
  private deliver(subscription: Subscription, send: () => void): void {
    if (subscription.closed) return;
    try {
      send();
    } catch (error) {
      this.log("system-info: a panel could not be told", error);
    }
  }

  private readTavora(): TavoraUsage | null {
    try {
      return this.tavora();
    } catch (error) {
      this.log("system-info: could not read Tavora's own use", error);
      return null;
    }
  }

  private snapshotFor(subscription: Subscription, sample: ProbeSample, tavora: TavoraUsage | null, at: number): SystemSnapshot {
    const request = subscription.request!;
    const blocks: WatchBlocks = request.blocks;
    const withPeak = request.intervalMs >= PEAK_FROM_MS;
    const snapshot: SystemSnapshot = { at, intervalMs: request.intervalMs };
    if (blocks.cpu && subscription.cpu.count > 0) {
      const usage = percent(subscription.cpu.sum / subscription.cpu.count);
      snapshot.cpu = {
        usage,
        peak: withPeak ? percent(subscription.cpu.peak) : usage,
        cores: (sample.cpuCores ?? []).map(percent),
      };
    }
    if (blocks.gpu) {
      const gpus = this.knownInfo()?.gpus ?? [];
      if (gpus.length > 0) {
        snapshot.gpus = gpus.map((gpu) => {
          const readings = subscription.gpu.get(gpu.id);
          const usage = readings && readings.count > 0 ? percent(readings.sum / readings.count) : 0;
          const used = sample.gpuMemory?.get(gpu.id);
          const sensors = sample.gpuSensors?.get(gpu.id);
          return {
            id: gpu.id,
            usage,
            peak: withPeak && readings ? percent(readings.peak) : usage,
            vramUsedBytes: used ?? null,
            temperatureC: sensors?.temperatureC ?? null,
            clockMhz: sensors?.clockMhz ?? null,
            powerW: sensors?.powerW ?? null,
          };
        });
      }
    }
    if (blocks.ram) {
      const totalBytes = os.totalmem();
      snapshot.ram = { usedBytes: Math.max(0, totalBytes - os.freemem()), totalBytes };
    }
    if (blocks.drives.length > 0) snapshot.drives = blocks.drives.map((id) => this.driveReading(id, sample));
    if (blocks.connection && this.connection) snapshot.connection = this.connection.read();
    if (blocks.tavora && tavora) snapshot.tavora = { cpu: percent(tavora.cpu), memoryBytes: Math.max(0, Math.round(tavora.memoryBytes)) };
    return snapshot;
  }

  /** The cached info, read now if it is missing; null when this PC can't tell. */
  private knownInfo(): SystemInfo | null {
    try {
      return this.info();
    } catch (error) {
      this.log("system-info: could not read the hardware", error);
      return null;
    }
  }

  private driveReading(id: string, sample: ProbeSample): NonNullable<SystemSnapshot["drives"]>[number] {
    const bit = id.charCodeAt(0) - 65;
    const connected = this.mask !== null && (this.mask & (1 << bit)) !== 0;
    if (!connected) return { id, connected: false, freeBytes: null, totalBytes: null, readBytesPerSec: 0, writeBytesPerSec: 0 };
    // Network drives can hang a read, so they are never asked (system-info-windows.ts).
    const kind = this.knownInfo()?.drives.find((drive) => drive.id === id)?.kind;
    let space: { freeBytes: number; totalBytes: number } | null = null;
    if (kind !== "network") {
      try {
        space = this.probe.driveSpace(id[0]!);
      } catch (error) {
        this.log("system-info: could not read a drive's space", error);
      }
    }
    const io = sample.driveIo?.get(id);
    return {
      id,
      connected: true,
      freeBytes: space?.freeBytes ?? null,
      totalBytes: space?.totalBytes ?? null,
      readBytesPerSec: Math.max(0, Math.round(io?.read ?? 0)),
      writeBytesPerSec: Math.max(0, Math.round(io?.write ?? 0)),
    };
  }
}
