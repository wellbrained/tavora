import { describe, expect, it } from "vitest";
import { NO_PARTS, type ProbeParts, type ProbeSample } from "./system-info";
import { COUNTER_GPU_MS, GpuReader, matchNvml, type DxgiAdapter, type NvmlApi, type NvmlDevice } from "./system-info-gpu";

const NVIDIA = 0x10de;
const INTEL = 0x8086;
const RTX: DxgiAdapter = { id: "0x00000000_0x0000aaaa", vendor: NVIDIA, deviceId: 0x2206, subSysId: 0x38931043 };
const INTEL_GPU: DxgiAdapter = { id: "0x00000000_0x0000bbbb", vendor: INTEL, deviceId: 0x4680, subSysId: 0x1 };
const RTX_DEVICE: NvmlDevice = { index: 0, bus: 1, pciDeviceId: (0x2206 << 16) | NVIDIA, pciSubSystemId: 0x38931043 };

describe("matchNvml", () => {
  it("pairs an adapter with the NVML card that has the same device and subsystem id", () => {
    expect([...matchNvml([RTX, INTEL_GPU], [RTX_DEVICE])]).toEqual([[RTX.id, 0]]);
  });

  it("does not pair cards with a different device or subsystem id", () => {
    expect(matchNvml([RTX], [{ ...RTX_DEVICE, pciDeviceId: (0x2204 << 16) | NVIDIA }]).size).toBe(0);
    expect(matchNvml([RTX], [{ ...RTX_DEVICE, pciSubSystemId: 0x1 }]).size).toBe(0);
  });

  it("never pairs a card of another maker", () => {
    expect(matchNvml([INTEL_GPU], [{ index: 0, bus: 0, pciDeviceId: (0x4680 << 16) | INTEL, pciSubSystemId: 1 }]).size).toBe(0);
  });

  it("pairs identical cards in order: NVML by PCI bus, DXGI as listed", () => {
    const second: DxgiAdapter = { ...RTX, id: "0x00000000_0x0000cccc" };
    const devices: NvmlDevice[] = [
      { ...RTX_DEVICE, index: 0, bus: 0x41 },
      { ...RTX_DEVICE, index: 1, bus: 0x01 },
    ];
    expect([...matchNvml([RTX, second], devices)]).toEqual([
      [RTX.id, 1],
      [second.id, 0],
    ]);
  });

  it("leaves a group alone when the two sides count differently", () => {
    const second: DxgiAdapter = { ...RTX, id: "0x00000000_0x0000cccc" };
    expect(matchNvml([RTX, second], [RTX_DEVICE]).size).toBe(0);
  });
});

const PARTS: ProbeParts = { ...NO_PARTS, gpuUsage: true, gpuMemory: true };

function fakeNvml(overrides: Partial<NvmlApi> = {}): NvmlApi & { shutdowns: number } {
  const api = {
    shutdowns: 0,
    devices: () => [RTX_DEVICE],
    utilization: () => 37,
    usedBytes: () => 9.4e9,
    temperatureC: () => 64,
    clockMhz: () => 1905,
    powerMilliwatts: () => 310_449,
    shutdown() {
      api.shutdowns++;
    },
    ...overrides,
  };
  return api;
}

function setup(options: { nvml?: () => NvmlApi | null; adapters?: DxgiAdapter[] } = {}) {
  const clock = { now: 0 };
  const log = { opened: [] as string[], closed: [] as string[], usageReads: 0, memoryReads: 0 };
  let busy = 20;
  const reader = new GpuReader({
    nvml: options.nvml ?? (() => fakeNvml()),
    adapters: () => options.adapters ?? [RTX],
    counters: {
      open: (part) => log.opened.push(part),
      close: (part) => log.closed.push(part),
      usage: () => {
        log.usageReads++;
        return new Map([[INTEL_GPU.id, (busy += 1)], [RTX.id, 99]]);
      },
      memory: () => {
        log.memoryReads++;
        return new Map([[INTEL_GPU.id, 5e8], [RTX.id, 1]]);
      },
    },
    now: () => clock.now,
  });
  return { reader, clock, log };
}

const collect = (reader: GpuReader, parts = PARTS): ProbeSample => {
  const sample: ProbeSample = {};
  reader.collect(parts, sample);
  return sample;
};

describe("GpuReader with NVML", () => {
  it("reads an NVIDIA card through NVML and opens no counter at all", () => {
    const { reader, log } = setup();
    expect(reader.configure(PARTS)).toBe(false);
    expect(log.opened).toEqual([]);
    const sample = collect(reader);
    expect(sample.gpuUsage).toEqual(new Map([[RTX.id, 37]]));
    expect(sample.gpuMemory).toEqual(new Map([[RTX.id, 9.4e9]]));
    expect(sample.gpuSensors).toEqual(new Map([[RTX.id, { temperatureC: 64, clockMhz: 1905, powerW: 310.4 }]]));
    expect(log.usageReads + log.memoryReads).toBe(0);
    expect(reader.describe()).toEqual([{ id: RTX.id, via: "nvml" }]);
  });

  it("reads only usage when the video memory and sensors are not due", () => {
    const { reader } = setup();
    reader.configure(PARTS);
    const sample = collect(reader, { ...NO_PARTS, gpuUsage: true });
    expect(sample.gpuUsage?.get(RTX.id)).toBe(37);
    expect(sample.gpuMemory).toBeUndefined();
    expect(sample.gpuSensors).toBeUndefined();
  });

  it("leaves just the value null when one call fails", () => {
    const { reader } = setup({ nvml: () => fakeNvml({ temperatureC: () => null, powerMilliwatts: () => null, usedBytes: () => null }) });
    reader.configure(PARTS);
    const sample = collect(reader);
    expect(sample.gpuMemory?.size).toBe(0);
    expect(sample.gpuSensors?.get(RTX.id)).toEqual({ temperatureC: null, clockMhz: 1905, powerW: null });
    expect(sample.gpuUsage?.get(RTX.id)).toBe(37);
  });

  it("shuts NVML down when closed and starts it again on the next look", () => {
    const apis: ReturnType<typeof fakeNvml>[] = [];
    const { reader } = setup({ nvml: () => (apis.push(fakeNvml()), apis.at(-1)!) });
    reader.configure(PARTS);
    reader.close();
    expect(apis[0]!.shutdowns).toBe(1);
    reader.configure(PARTS);
    expect(apis).toHaveLength(2);
    expect(collect(reader).gpuUsage?.get(RTX.id)).toBe(37);
  });

  it("does not load NVML when there is no NVIDIA card", () => {
    let loads = 0;
    const { reader } = setup({ adapters: [INTEL_GPU], nvml: () => (loads++, fakeNvml()) });
    reader.configure(PARTS);
    expect(loads).toBe(0);
  });
});

describe("GpuReader without NVML", () => {
  it.each([
    ["is missing", () => null],
    [
      "will not start",
      () => {
        throw new Error("nvmlInit failed");
      },
    ],
    ["lists no card", () => fakeNvml({ devices: () => [] })],
  ])("falls back to the counters when nvml.dll %s", (_name, nvml) => {
    const { reader, log } = setup({ nvml });
    expect(reader.configure(PARTS)).toBe(true);
    expect(log.opened).toEqual(["gpuUsage", "gpuMemory"]);
    const sample = collect(reader);
    // The RTX counts from the counters now, so its numbers come from there.
    expect(sample.gpuUsage?.get(RTX.id)).toBe(99);
    expect(sample.gpuMemory?.get(RTX.id)).toBe(1);
    expect(sample.gpuSensors?.size).toBe(0);
    expect(reader.describe()).toEqual([{ id: RTX.id, via: "counters" }]);
  });

  it("shuts NVML down when it listed no card of ours", () => {
    const api = fakeNvml({ devices: () => [] });
    const { reader } = setup({ nvml: () => api });
    reader.configure(PARTS);
    expect(api.shutdowns).toBe(1);
  });
});

describe("GpuReader with a mix of cards", () => {
  const mixed = () => setup({ adapters: [RTX, INTEL_GPU] });

  it("opens the counters for the other card only and takes the NVIDIA card from NVML", () => {
    const { reader, log } = mixed();
    expect(reader.configure(PARTS)).toBe(true);
    expect(log.opened).toEqual(["gpuUsage", "gpuMemory"]);
    const sample = collect(reader);
    expect(sample.gpuUsage).toEqual(new Map([[RTX.id, 37], [INTEL_GPU.id, 21]]));
    expect(sample.gpuMemory).toEqual(new Map([[RTX.id, 9.4e9], [INTEL_GPU.id, 5e8]]));
    expect(reader.describe()).toEqual([
      { id: RTX.id, via: "nvml" },
      { id: INTEL_GPU.id, via: "counters" },
    ]);
  });

  it("reads the counters at most every 5 seconds and reuses the last numbers in between", () => {
    const { reader, clock, log } = mixed();
    reader.configure(PARTS);
    const seen: (number | undefined)[] = [];
    for (let second = 0; second <= 12; second++) {
      clock.now = second * 1000;
      seen.push(collect(reader).gpuUsage?.get(INTEL_GPU.id));
      expect(collect(reader).gpuUsage?.get(RTX.id)).toBe(37);
    }
    // Reads at 0 s, 5 s and 10 s only.
    expect(log.usageReads).toBe(3);
    expect(seen).toEqual([21, 21, 21, 21, 21, 22, 22, 22, 22, 22, 23, 23, 23]);
    expect(COUNTER_GPU_MS).toBe(5000);
  });

  it("closes the counters when nothing needs them", () => {
    const { reader, log } = mixed();
    reader.configure(PARTS);
    reader.configure({ ...NO_PARTS, gpuUsage: true });
    expect(log.closed).toEqual(["gpuMemory"]);
    reader.close();
    expect(log.closed).toEqual(["gpuMemory", "gpuUsage"]);
  });
});
