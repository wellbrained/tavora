/**
 * Reads this PC for the system-info connector (system-info.ts), straight from Windows inside Tavora's own
 * process: the performance counters Task Manager uses (pdh.dll), the drive list (kernel32.dll) and the names of the
 * graphics cards (DXGI). NVIDIA cards are read through NVIDIA's own library that ships with the driver (nvml.dll;
 * system-info-gpu.ts), because the GPU counters are costly for a game running at the same time. No helper program,
 * no WMI and no driver of ours is involved, and nothing is run: it is a handful of calls into the libraries already
 * on the PC. Windows only: koffi is loaded on the first look, never elsewhere.
 */
import os from "node:os";
import type { SystemInfo } from "@tavora/sdk/protocol";
import { coresInOrder, gpuMemoryByAdapter, gpuUsageByAdapter, luidId, percent } from "./system-info-parse";
import { type ProbeParts, type ProbeSample, type SystemProbe } from "./system-info";
import { GpuReader, type DxgiAdapter, type NvmlApi, type NvmlDevice } from "./system-info-gpu";

const PDH_FMT_DOUBLE = 0x200;
const PDH_MORE_DATA = 0x800007d2;
const PDH_CSTATUS_VALID_DATA = 0;
const PDH_CSTATUS_NEW_DATA = 1;
/** One PDH_FMT_COUNTERVALUE_ITEM_W on 64-bit Windows: a name pointer, a status (padded), and a double. */
const ITEM_BYTES = 24;
/** Video memory a graphics card needs of its own to count as dedicated. */
const DEDICATED_MIN_BYTES = 512 * 1024 * 1024;

const DRIVE_REMOVABLE = 2;
const DRIVE_FIXED = 3;
const DRIVE_REMOTE = 4;
const DRIVE_CDROM = 5;
const DRIVE_NO_ROOT_DIR = 1;

/** The counters of each part, as Windows names them in English. */
const COUNTERS = {
  cpuTotal: ["\\Processor Information(_Total)\\% Processor Utility"],
  cpuCores: ["\\Processor Information(*)\\% Processor Utility"],
  gpuUsage: ["\\GPU Engine(*)\\Utilization Percentage"],
  gpuMemory: ["\\GPU Adapter Memory(*)\\Dedicated Usage"],
  driveIo: ["\\LogicalDisk(*)\\Disk Read Bytes/sec", "\\LogicalDisk(*)\\Disk Write Bytes/sec"],
} as const satisfies Record<keyof ProbeParts, readonly string[]>;
const PART_NAMES = Object.keys(COUNTERS) as (keyof ProbeParts)[];

interface Native {
  pdhOpenQuery: (source: null, user: number, query: unknown[]) => number;
  pdhAddCounter: (query: unknown, path: string, user: number, counter: unknown[]) => number;
  pdhCollect: (query: unknown) => number;
  pdhClose: (query: unknown) => number;
  pdhValue: (counter: unknown, format: number, type: number[], value: Buffer) => number;
  pdhArray: (counter: unknown, format: number, size: number[], count: number[], buffer: Buffer | null) => number;
  getLogicalDrives: () => number;
  getDriveType: (root: string) => number;
  getVolumeInformation: (root: string, label: Uint16Array, size: number, serial: null, maxName: null, flags: null, fs: null, fsSize: number) => number;
  getDiskFreeSpaceEx: (root: string, available: BigUint64Array, total: BigUint64Array, free: BigUint64Array) => number;
  adapters: () => { name: string; flags: number; vendor: number; deviceId: number; subSysId: number; dedicatedBytes: number; high: number; low: number }[];
}

interface Query {
  handle: unknown;
  counters: unknown[];
}

function loadNative(): Native {
  // Outside the bundle (scripts/targets.mjs): koffi loads a native file next to it in node_modules.
  const koffi = require("koffi") as typeof import("koffi");
  const pdh = koffi.load("pdh.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const dxgi = koffi.load("dxgi.dll");
  const createFactory = dxgi.func("long __stdcall CreateDXGIFactory1(const void *iid, _Out_ void **factory)");
  // IID_IDXGIFactory1 {770aae78-f26f-4dba-a829-253c83d1b387}
  const factoryIid = Buffer.from("78ae0a776ff2ba4da829253c83d1b387", "hex");
  const enumAdapters1 = koffi.proto("long __stdcall EnumAdapters1(void *self, uint32_t index, _Out_ void **adapter)");
  const getDesc1 = koffi.proto("long __stdcall GetDesc1(void *self, _Out_ uint8_t *desc)");
  const release = koffi.proto("uint32_t __stdcall Release(void *self)");
  /** The function in slot `slot` of a COM object's table. */
  const method = (object: unknown, slot: number, proto: unknown) => {
    const table = koffi.decode(koffi.decode(object, "void *"), "void *[16]") as unknown[];
    return koffi.decode(table[slot], proto as never) as (...args: unknown[]) => unknown;
  };
  return {
    pdhOpenQuery: pdh.func("long __stdcall PdhOpenQueryW(void *source, uintptr_t user, _Out_ void **query)"),
    pdhAddCounter: pdh.func("long __stdcall PdhAddEnglishCounterW(void *query, str16 path, uintptr_t user, _Out_ void **counter)"),
    pdhCollect: pdh.func("long __stdcall PdhCollectQueryData(void *query)"),
    pdhClose: pdh.func("long __stdcall PdhCloseQuery(void *query)"),
    pdhValue: pdh.func("long __stdcall PdhGetFormattedCounterValue(void *counter, uint32_t format, _Out_ uint32_t *type, _Out_ uint8_t *value)"),
    pdhArray: pdh.func("long __stdcall PdhGetFormattedCounterArrayW(void *counter, uint32_t format, _Inout_ uint32_t *size, _Inout_ uint32_t *count, uint8_t *buffer)"),
    getLogicalDrives: kernel32.func("uint32_t __stdcall GetLogicalDrives()"),
    getDriveType: kernel32.func("uint32_t __stdcall GetDriveTypeW(str16 root)"),
    getVolumeInformation: kernel32.func(
      "int __stdcall GetVolumeInformationW(str16 root, _Out_ uint16_t *label, uint32_t size, void *serial, void *maxName, void *flags, void *fs, uint32_t fsSize)",
    ),
    getDiskFreeSpaceEx: kernel32.func("int __stdcall GetDiskFreeSpaceExW(str16 root, _Out_ uint64_t *available, _Out_ uint64_t *total, _Out_ uint64_t *free)"),
    adapters: () => {
      const factory = [null as unknown];
      if (createFactory(factoryIid, factory) !== 0 || !factory[0]) return [];
      const found: ReturnType<Native["adapters"]> = [];
      try {
        // IDXGIFactory1::EnumAdapters1 is slot 12; IDXGIAdapter1::GetDesc1 is slot 10; Release is slot 2.
        const enumerate = method(factory[0], 12, enumAdapters1);
        for (let index = 0; index < 16; index++) {
          const adapter = [null as unknown];
          if ((enumerate(factory[0], index, adapter) as number) !== 0 || !adapter[0]) break;
          try {
            // DXGI_ADAPTER_DESC1: 128 UTF-16 characters, then ids, three sizes, the LUID and the flags (312 bytes).
            const desc = Buffer.alloc(312);
            if ((method(adapter[0], 10, getDesc1)(adapter[0], desc) as number) === 0) {
              found.push({
                name: desc.toString("utf16le", 0, 256).split("\0")[0]!.trim(),
                vendor: desc.readUInt32LE(256),
                deviceId: desc.readUInt32LE(260),
                subSysId: desc.readUInt32LE(264),
                dedicatedBytes: Number(desc.readBigUInt64LE(272)),
                low: desc.readUInt32LE(296),
                high: desc.readInt32LE(300),
                flags: desc.readUInt32LE(304),
              });
            }
          } finally {
            method(adapter[0], 2, release)(adapter[0]);
          }
        }
      } finally {
        method(factory[0], 2, release)(factory[0]);
      }
      return found;
    },
  };
}

/** Where NVIDIA's driver puts nvml.dll: Windows' own folder first, then the older driver folder. */
function nvmlPaths(): string[] {
  const windows = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  const programs = process.env.ProgramW6432 ?? process.env.ProgramFiles ?? "C:\\Program Files";
  return [`${windows}\\System32\\nvml.dll`, `${programs}\\NVIDIA Corporation\\NVSMI\\nvml.dll`];
}

const NVML_SUCCESS = 0;
const NVML_TEMPERATURE_GPU = 0;
const NVML_CLOCK_GRAPHICS = 0;

/**
 * NVIDIA's library, started: null when there is no nvml.dll or it will not start. Structs as in nvml.h:
 * nvmlUtilization_t is two uint (gpu, memory), nvmlMemory_t three uint64 (total, free, used), and nvmlPciInfo_t is
 * busIdLegacy[16], domain, bus, device, pciDeviceId, pciSubSystemId (uint each, at 16, 20, 24, 28, 32) and busId[32].
 * Throws when a function is missing; GpuReader then falls back to the counters.
 */
export function loadNvml(): NvmlApi | null {
  const koffi = require("koffi") as typeof import("koffi");
  for (const file of nvmlPaths()) {
    let library: ReturnType<typeof koffi.load>;
    try {
      library = koffi.load(file);
    } catch {
      continue;
    }
    const init = library.func("int nvmlInit_v2()");
    const shutdown = library.func("int nvmlShutdown()");
    const getCount = library.func("int nvmlDeviceGetCount_v2(_Out_ uint8_t *count)");
    const getHandle = library.func("int nvmlDeviceGetHandleByIndex_v2(uint32_t index, _Out_ void **device)");
    const getPci = library.func("int nvmlDeviceGetPciInfo_v3(void *device, _Out_ uint8_t *pci)");
    const getUtilization = library.func("int nvmlDeviceGetUtilizationRates(void *device, _Out_ uint8_t *utilization)");
    const getMemory = library.func("int nvmlDeviceGetMemoryInfo(void *device, _Out_ uint8_t *memory)");
    const getTemperature = library.func("int nvmlDeviceGetTemperature(void *device, int sensor, _Out_ uint8_t *degrees)");
    const getClock = library.func("int nvmlDeviceGetClockInfo(void *device, int clock, _Out_ uint8_t *mhz)");
    const getPower = library.func("int nvmlDeviceGetPowerUsage(void *device, _Out_ uint8_t *milliwatts)");
    if ((init() as number) !== NVML_SUCCESS) continue;
    const handles = new Map<number, unknown>();
    const scratch = Buffer.alloc(128);
    const handle = (index: number): unknown => {
      let found = handles.get(index);
      if (!found) {
        const out = [null as unknown];
        if ((getHandle(index, out) as number) !== NVML_SUCCESS || !out[0]) return null;
        handles.set(index, (found = out[0]));
      }
      return found;
    };
    /** Runs one NVML call on a card and gives the buffer it filled, or null when it failed. */
    const call = (index: number, run: (device: unknown, out: Buffer) => number): Buffer | null => {
      const device = handle(index);
      if (!device) return null;
      scratch.fill(0);
      try {
        return run(device, scratch) === NVML_SUCCESS ? scratch : null;
      } catch {
        return null;
      }
    };
    return {
      devices() {
        const count = Buffer.alloc(4);
        if ((getCount(count) as number) !== NVML_SUCCESS) return [];
        const devices: NvmlDevice[] = [];
        for (let index = 0; index < count.readUInt32LE(0); index++) {
          const pci = call(index, (device, out) => getPci(device, out) as number);
          if (pci) devices.push({ index, bus: pci.readUInt32LE(20), pciDeviceId: pci.readUInt32LE(28), pciSubSystemId: pci.readUInt32LE(32) });
        }
        return devices;
      },
      utilization: (index) => call(index, (device, out) => getUtilization(device, out) as number)?.readUInt32LE(0) ?? null,
      usedBytes: (index) => {
        const memory = call(index, (device, out) => getMemory(device, out) as number);
        return memory ? Number(memory.readBigUInt64LE(16)) : null;
      },
      temperatureC: (index) => call(index, (device, out) => getTemperature(device, NVML_TEMPERATURE_GPU, out) as number)?.readUInt32LE(0) ?? null,
      clockMhz: (index) => call(index, (device, out) => getClock(device, NVML_CLOCK_GRAPHICS, out) as number)?.readUInt32LE(0) ?? null,
      powerMilliwatts: (index) => call(index, (device, out) => getPower(device, out) as number)?.readUInt32LE(0) ?? null,
      shutdown() {
        handles.clear();
        shutdown();
      },
    };
  }
  return null;
}

/** DXGI_ADAPTER_FLAG_SOFTWARE, and Microsoft's vendor id for its Basic Render Driver. */
const SOFTWARE_FLAG = 2;
const MICROSOFT_VENDOR = 0x1414;

/** The probe, and which way each graphics card is read (for scripts/perf-system-info.mjs). */
export type WindowsSystemProbe = SystemProbe & { describeGpus(): { id: string; via: "nvml" | "counters" }[] };

/** A probe for this PC. Throws on the first look when Windows' functions can't be loaded. */
export function windowsSystemProbe(): WindowsSystemProbe {
  let native: Native | null = null;
  const load = () => (native ??= loadNative());
  const queries = new Map<keyof ProbeParts, Query>();
  const buffers = new Map<string, Buffer>();

  function openQuery(part: keyof ProbeParts): Query {
    const n = load();
    const query = [null as unknown];
    if (n.pdhOpenQuery(null, 0, query) !== 0) throw new Error(`could not open a counter query for ${part}`);
    const counters: unknown[] = [];
    for (const path of COUNTERS[part]) {
      const counter = [null as unknown];
      if (n.pdhAddCounter(query[0], path, 0, counter) !== 0) {
        n.pdhClose(query[0]);
        throw new Error(`Windows has no counter ${path}`);
      }
      counters.push(counter[0]);
    }
    n.pdhCollect(query[0]);
    return { handle: query[0], counters };
  }

  /** One number from a counter, or null when Windows has no valid reading yet. */
  function value(counter: unknown): number | null {
    const n = load();
    const buffer = Buffer.alloc(16);
    if (n.pdhValue(counter, PDH_FMT_DOUBLE, [0], buffer) !== 0) return null;
    const status = buffer.readUInt32LE(0);
    return status === PDH_CSTATUS_VALID_DATA || status === PDH_CSTATUS_NEW_DATA ? buffer.readDoubleLE(8) : null;
  }

  /** Every instance of a wildcard counter: its name and number. */
  function instances(counter: unknown, key: string): { name: string; value: number }[] {
    const n = load();
    const size = [0];
    const count = [0];
    let buffer = buffers.get(key) ?? null;
    let result = PDH_MORE_DATA;
    // The first call may only say how big the answer is; instances may also appear between two calls.
    for (let attempt = 0; attempt < 4 && result === PDH_MORE_DATA; attempt++) {
      size[0] = buffer?.length ?? 0;
      result = (n.pdhArray(counter, PDH_FMT_DOUBLE, size, count, buffer) as number) >>> 0;
      if (result === PDH_MORE_DATA) {
        // Some room for instances that appear before the next look; the buffer is kept for the next one.
        buffer = Buffer.alloc(Math.ceil(size[0]! * 1.25) + 1024);
        buffers.set(key, buffer);
      }
    }
    if (result !== 0 || !buffer) return [];
    const total = count[0]!;
    if (total === 0) return [];
    // The names are in the same buffer after the items; each item points at its own.
    const first = buffer.readBigUInt64LE(0);
    const areaStart = total * ITEM_BYTES;
    const items: { name: string; value: number }[] = [];
    for (let index = 0; index < total; index++) {
      const at = index * ITEM_BYTES;
      const status = buffer.readUInt32LE(at + 8);
      if (status !== PDH_CSTATUS_VALID_DATA && status !== PDH_CSTATUS_NEW_DATA) continue;
      let start = Number(buffer.readBigUInt64LE(at) - first) + areaStart;
      if (start < 0 || start >= buffer.length) continue;
      let end = start;
      while (end + 1 < buffer.length && buffer.readUInt16LE(end) !== 0) end += 2;
      items.push({ name: buffer.toString("utf16le", start, end), value: buffer.readDoubleLE(at + 16) });
    }
    return items;
  }

  const gpu = new GpuReader({
    nvml: loadNvml,
    adapters: () =>
      load()
        .adapters()
        .filter((adapter) => (adapter.flags & SOFTWARE_FLAG) === 0 && adapter.vendor !== MICROSOFT_VENDOR)
        .map((adapter): DxgiAdapter => ({ id: luidId(adapter.high, adapter.low), vendor: adapter.vendor, deviceId: adapter.deviceId, subSysId: adapter.subSysId })),
    counters: {
      open: (part) => queries.set(part, openQuery(part)),
      close: (part) => {
        const open = queries.get(part);
        if (open) load().pdhClose(open.handle);
        queries.delete(part);
      },
      usage: () => {
        const query = collect("gpuUsage");
        return query ? gpuUsageByAdapter(instances(query.counters[0], "gpuUsage")) : null;
      },
      memory: () => {
        const query = collect("gpuMemory");
        return query ? gpuMemoryByAdapter(instances(query.counters[0], "gpuMemory")) : null;
      },
    },
  });

  function collect(part: keyof ProbeParts): Query | null {
    const query = queries.get(part);
    if (!query) return null;
    return load().pdhCollect(query.handle) === 0 ? query : null;
  }

  function driveLetters(mask: number): string[] {
    const letters: string[] = [];
    for (let bit = 0; bit < 26; bit++) if (mask & (1 << bit)) letters.push(String.fromCharCode(65 + bit));
    return letters;
  }

  const space = (letter: string): { freeBytes: number; totalBytes: number } | null => {
    const n = load();
    const available = new BigUint64Array(1);
    const total = new BigUint64Array(1);
    if (!n.getDiskFreeSpaceEx(`${letter}:\\`, available, total, new BigUint64Array(1))) return null;
    return { freeBytes: Number(available[0]), totalBytes: Number(total[0]) };
  };

  return {
    info() {
      const n = load();
      const cpus = os.cpus();
      const gpus: SystemInfo["gpus"] = [];
      try {
        for (const adapter of n.adapters()) {
          if ((adapter.flags & SOFTWARE_FLAG) !== 0 || adapter.vendor === MICROSOFT_VENDOR) continue;
          gpus.push({
            id: luidId(adapter.high, adapter.low),
            name: adapter.name,
            dedicated: adapter.dedicatedBytes >= DEDICATED_MIN_BYTES,
            vramBytes: adapter.dedicatedBytes > 0 ? adapter.dedicatedBytes : null,
          });
        }
      } catch {
        // No graphics card names; usage can still be read.
      }
      const drives: SystemInfo["drives"] = [];
      for (const letter of driveLetters(n.getLogicalDrives())) {
        const root = `${letter}:\\`;
        const type = n.getDriveType(root);
        if (type === DRIVE_CDROM || type === DRIVE_NO_ROOT_DIR || type === 0) continue;
        const kind = type === DRIVE_FIXED ? "internal" : type === DRIVE_REMOVABLE ? "removable" : type === DRIVE_REMOTE ? "network" : "other";
        let label = "";
        let totalBytes: number | null = null;
        // A network drive that doesn't answer can hold the whole app up, so it is neither named nor measured.
        if (kind !== "network") {
          const name = new Uint16Array(261);
          if (n.getVolumeInformation(root, name, name.length, null, null, null, null, 0)) {
            const end = name.indexOf(0);
            label = Buffer.from(name.buffer, 0, (end < 0 ? name.length : end) * 2).toString("utf16le");
          }
          totalBytes = space(letter)?.totalBytes ?? null;
        }
        drives.push({ id: `${letter}:`, label, kind, totalBytes });
      }
      return {
        cpu: { model: (cpus[0]?.model ?? "").trim(), threads: cpus.length },
        ramBytes: os.totalmem(),
        gpus,
        drives,
      };
    },
    driveMask: () => load().getLogicalDrives(),
    configure(parts) {
      let fresh = gpu.configure(parts);
      for (const part of PART_NAMES) {
        // The graphics card parts are the GpuReader's: NVIDIA cards need no counter at all.
        if (part === "gpuUsage" || part === "gpuMemory") continue;
        const open = queries.get(part);
        if (parts[part] && !open) {
          queries.set(part, openQuery(part));
          fresh = true;
        } else if (!parts[part] && open) {
          load().pdhClose(open.handle);
          queries.delete(part);
        }
      }
      return fresh;
    },
    collect(parts) {
      const sample: ProbeSample = {};
      if (parts.cpuTotal) {
        const query = collect("cpuTotal");
        const reading = query ? value(query.counters[0]) : null;
        if (reading !== null) sample.cpuTotal = percent(reading);
      }
      if (parts.cpuCores) {
        const query = collect("cpuCores");
        if (query) sample.cpuCores = coresInOrder(instances(query.counters[0], "cpuCores")).map(percent);
      }
      if (parts.gpuUsage || parts.gpuMemory) gpu.collect(parts, sample);
      if (parts.driveIo) {
        const query = collect("driveIo");
        if (query) {
          const io = new Map<string, { read: number; write: number }>();
          const read = instances(query.counters[0], "driveRead");
          const write = instances(query.counters[1], "driveWrite");
          for (const { name, value: bytes } of read) if (/^[A-Z]:$/.test(name)) io.set(name, { read: bytes, write: 0 });
          for (const { name, value: bytes } of write) {
            const entry = io.get(name);
            if (entry) entry.write = bytes;
          }
          sample.driveIo = io;
        }
      }
      return sample;
    },
    driveSpace: space,
    describeGpus: () => gpu.describe(),
    close() {
      gpu.close();
      for (const query of queries.values()) load().pdhClose(query.handle);
      queries.clear();
      buffers.clear();
    },
  };
}

/** A probe for a PC that isn't Windows: what Node knows, and nothing to watch. */
export function unsupportedSystemProbe(): SystemProbe {
  return {
    info() {
      const cpus = os.cpus();
      return { cpu: { model: (cpus[0]?.model ?? "").trim(), threads: cpus.length }, ramBytes: os.totalmem(), gpus: [], drives: [] };
    },
    driveMask: () => 0,
    configure: () => false,
    collect: () => ({}),
    driveSpace: () => null,
    close: () => undefined,
  };
}

/** The probe for this PC. */
export function systemProbe(): SystemProbe {
  return process.platform === "win32" ? windowsSystemProbe() : unsupportedSystemProbe();
}
