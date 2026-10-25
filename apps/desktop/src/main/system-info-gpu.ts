/**
 * The graphics card part of the system-info connector (system-info.ts), without touching the PC itself: which
 * cards NVIDIA's own library (NVML) can read, and when the Windows counters are read for the others. The calls into
 * Windows and into nvml.dll are handed in (system-info-windows.ts), so this is tested with fakes.
 *
 * Why two ways: the `GPU Engine` counters list every process's graphics engines inside the driver, and reading them
 * showed up as small hitches in a running game. NVML asks the card directly and costs nothing measurable, so NVIDIA
 * cards use it. Other cards (AMD, Intel, or NVIDIA without nvml.dll) keep the counters, read at most every 5 seconds.
 */
import type { ProbeParts, ProbeSample } from "./system-info";

/** PCI vendor id of NVIDIA. */
export const NVIDIA_VENDOR = 0x10de;
/** The counters of the cards NVML does not cover are read at most this often, whatever the interval. */
export const COUNTER_GPU_MS = 5000;

/** A graphics card as DXGI lists it. */
export interface DxgiAdapter {
  /** The card's id as the connector reports it (its LUID). */
  id: string;
  vendor: number;
  deviceId: number;
  subSysId: number;
}

/** A graphics card as NVML lists it, with the PCI numbers of `nvmlDeviceGetPciInfo_v3`. */
export interface NvmlDevice {
  index: number;
  /** PCI device id in the high 16 bits, vendor id in the low 16 bits. */
  pciDeviceId: number;
  pciSubSystemId: number;
  bus: number;
}

/** What the reader needs from nvml.dll. Every reading is null when that one call fails. */
export interface NvmlApi {
  devices(): NvmlDevice[];
  /** 0 to 100. */
  utilization(index: number): number | null;
  usedBytes(index: number): number | null;
  /** Degrees Celsius of the GPU sensor. */
  temperatureC(index: number): number | null;
  /** Graphics clock in MHz. */
  clockMhz(index: number): number | null;
  /** Board power in milliwatts. */
  powerMilliwatts(index: number): number | null;
  shutdown(): void;
}

type CounterPart = "gpuUsage" | "gpuMemory";

/** What the reader needs of the Windows counters for graphics cards. */
export interface GpuCounters {
  open(part: CounterPart): void;
  close(part: CounterPart): void;
  usage(): Map<string, number> | null;
  memory(): Map<string, number> | null;
}

export interface GpuReaderOptions {
  /** Loads and starts NVML; null (or a throw) when it is not there. */
  nvml: () => NvmlApi | null;
  /** The graphics cards DXGI lists, without software adapters. */
  adapters: () => DxgiAdapter[];
  counters: GpuCounters;
  now?: () => number;
}

/**
 * Which NVML card is which DXGI adapter: the NVIDIA adapters are matched on vendor id, device id and subsystem id
 * (NVML's `pciDeviceId` is device id << 16 | vendor id). Cards with the same three numbers are paired in order: NVML's
 * by PCI bus number, DXGI's as Windows lists them. If a group has a different count on each side the pairing would be
 * a guess, so that group is left to the counters. Returns the adapter id to NVML index.
 */
export function matchNvml(adapters: readonly DxgiAdapter[], devices: readonly NvmlDevice[]): Map<string, number> {
  const matched = new Map<string, number>();
  const groups = new Map<string, { adapters: DxgiAdapter[]; devices: NvmlDevice[] }>();
  const group = (deviceId: number, subSysId: number) => {
    const key = `${deviceId}:${subSysId}`;
    let found = groups.get(key);
    if (!found) groups.set(key, (found = { adapters: [], devices: [] }));
    return found;
  };
  for (const adapter of adapters) {
    if (adapter.vendor === NVIDIA_VENDOR) group(adapter.deviceId, adapter.subSysId >>> 0).adapters.push(adapter);
  }
  for (const device of devices) {
    if ((device.pciDeviceId & 0xffff) === NVIDIA_VENDOR) group(device.pciDeviceId >>> 16, device.pciSubSystemId >>> 0).devices.push(device);
  }
  for (const { adapters: ours, devices: theirs } of groups.values()) {
    if (ours.length === 0 || ours.length !== theirs.length) continue;
    const ordered = [...theirs].sort((a, b) => a.bus - b.bus || a.index - b.index);
    ours.forEach((adapter, at) => matched.set(adapter.id, ordered[at]!.index));
  }
  return matched;
}

/** One NVML card's extra readings; null where that call failed. */
export interface GpuSensors {
  temperatureC: number | null;
  clockMhz: number | null;
  /** Watts with one decimal. */
  powerW: number | null;
}

const whole = (value: number | null): number | null => (value !== null && Number.isFinite(value) ? Math.round(value) : null);

/** Chooses NVML or the counters for each graphics card and reads them. */
export class GpuReader {
  private readonly options: GpuReaderOptions;
  private readonly now: () => number;
  private nvml: NvmlApi | null = null;
  private adapters: DxgiAdapter[] | null = null;
  private matched = new Map<string, number>();
  private prepared = false;
  private readonly counterOpen: Record<CounterPart, boolean> = { gpuUsage: false, gpuMemory: false };
  private last: Record<CounterPart, { at: number; values: Map<string, number> | null }> = {
    gpuUsage: { at: -Infinity, values: null },
    gpuMemory: { at: -Infinity, values: null },
  };

  constructor(options: GpuReaderOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /** Loads NVML and pairs the cards, once. Nothing here throws. */
  private prepare(): void {
    if (this.prepared) return;
    this.prepared = true;
    try {
      this.adapters = this.options.adapters();
    } catch {
      this.adapters = [];
    }
    if (!this.adapters.some((adapter) => adapter.vendor === NVIDIA_VENDOR)) return;
    try {
      const api = this.options.nvml();
      if (!api) return;
      this.nvml = api;
      this.matched = matchNvml(this.adapters, api.devices());
      if (this.matched.size === 0) this.release();
    } catch {
      this.matched = new Map();
      this.release();
    }
  }

  /** Which way each card is read, for the perf script and tests. */
  describe(): { id: string; via: "nvml" | "counters" }[] {
    this.prepare();
    return (this.adapters ?? []).map((adapter) => ({ id: adapter.id, via: this.matched.has(adapter.id) ? "nvml" : "counters" }));
  }

  /** Opens or closes the counters for the parts asked for. Returns whether one was just opened. */
  configure(parts: ProbeParts): boolean {
    if (parts.gpuUsage || parts.gpuMemory) this.prepare();
    // With every card on NVML there is no reason to open the GPU Engine counters at all.
    const needed = (this.adapters ?? []).some((adapter) => !this.matched.has(adapter.id));
    let fresh = false;
    for (const part of ["gpuUsage", "gpuMemory"] as const) {
      const want = parts[part] && needed;
      if (want && !this.counterOpen[part]) {
        this.options.counters.open(part);
        this.counterOpen[part] = true;
        this.last[part] = { at: -Infinity, values: null };
        fresh = true;
      } else if (!want && this.counterOpen[part]) {
        this.options.counters.close(part);
        this.counterOpen[part] = false;
      }
    }
    return fresh;
  }

  /** Reads the cards: NVML at every look, the counters at most every 5 seconds (in between, the last numbers). */
  collect(parts: ProbeParts, sample: ProbeSample): void {
    const usage = new Map<string, number>();
    const memory = new Map<string, number>();
    const sensors = new Map<string, GpuSensors>();
    const nvml = this.nvml;
    if (nvml) {
      for (const [id, index] of this.matched) {
        if (parts.gpuUsage) {
          const busy = nvml.utilization(index);
          if (busy !== null && Number.isFinite(busy)) usage.set(id, busy);
        }
        if (parts.gpuMemory) {
          const used = nvml.usedBytes(index);
          if (used !== null && Number.isFinite(used)) memory.set(id, used);
          const milliwatts = nvml.powerMilliwatts(index);
          sensors.set(id, {
            temperatureC: whole(nvml.temperatureC(index)),
            clockMhz: whole(nvml.clockMhz(index)),
            powerW: milliwatts !== null && Number.isFinite(milliwatts) ? Math.round(milliwatts / 100) / 10 : null,
          });
        }
      }
    }
    const now = this.now();
    for (const part of ["gpuUsage", "gpuMemory"] as const) {
      if (!parts[part] || !this.counterOpen[part]) continue;
      if (now - this.last[part].at >= COUNTER_GPU_MS) {
        const values = part === "gpuUsage" ? this.options.counters.usage() : this.options.counters.memory();
        // A failed read keeps the last good numbers rather than showing zero.
        if (values) this.last[part] = { at: now, values };
      }
      const into = part === "gpuUsage" ? usage : memory;
      for (const [id, value] of this.last[part].values ?? []) if (!this.matched.has(id)) into.set(id, value);
    }
    if (parts.gpuUsage) sample.gpuUsage = usage;
    if (parts.gpuMemory) {
      sample.gpuMemory = memory;
      sample.gpuSensors = sensors;
    }
  }

  /** Closes the counters and NVML; the next configure starts again. */
  close(): void {
    for (const part of ["gpuUsage", "gpuMemory"] as const) {
      if (this.counterOpen[part]) this.options.counters.close(part);
      this.counterOpen[part] = false;
    }
    this.last = { gpuUsage: { at: -Infinity, values: null }, gpuMemory: { at: -Infinity, values: null } };
    this.release();
    this.prepared = false;
    this.matched = new Map();
  }

  private release(): void {
    const nvml = this.nvml;
    this.nvml = null;
    try {
      nvml?.shutdown();
    } catch {
      // Shutting down a library that is already gone needs no word.
    }
  }
}
