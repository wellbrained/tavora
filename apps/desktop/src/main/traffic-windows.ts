/**
 * Reads Windows' record of this PC's traffic for traffic.ts, inside the system-info worker: the record behind
 * Settings > Network > Data usage, through Windows' own NetworkInformation API (Windows.Networking.Connectivity,
 * `ConnectionProfile.GetNetworkUsageAsync`). It is called through combase.dll with koffi, like DXGI in
 * system-info-windows.ts: no helper program, no PowerShell and no admin rights. Every network Windows knows is added up
 * (wired, Wi-Fi and mobile, also ones not connected now), but VPNs and other virtual adapters, whose traffic already
 * goes through a real one. Windows answers each question on its own threads; this only looks every few milliseconds
 * whether the answers are there, so nothing waits and nothing is called back. Windows only: koffi is loaded on the
 * first read, never elsewhere.
 */
import type { TrafficBytes, TrafficRange, TrafficReader } from "./traffic";

/** IIDs of the interfaces used. */
const IID_NETWORK_INFORMATION_STATICS = "5074f851-950d-4165-9c15-365619481eea";
const IID_CONNECTION_PROFILE_2 = "e2045145-4c9f-400c-9150-7ec7d6e2888a";
const IID_ASYNC_INFO = "00000036-0000-0000-c000-000000000046";
const RO_INIT_MULTITHREADED = 1;
/** RPC_E_CHANGED_MODE: the thread was set up another way already, which is fine for these calls. */
const RPC_E_CHANGED_MODE = 0x80010106 | 0;
/** DataUsageGranularity.Total: one sum for the whole range. */
const GRANULARITY_TOTAL = 3;
/** AsyncStatus.Started and .Completed. */
const STARTED = 0;
const COMPLETED = 1;
/** IanaInterfaceType of adapters left out: a virtual one (VPNs such as Tailscale or WireGuard), a tunnel and loopback. */
const VIRTUAL_TYPES = new Set([53, 131, 24]);
/** How often the answers are looked for, and how long they may take. */
const POLL_MS = 10;
const TIMEOUT_MS = 30_000;
/** Windows counts time in 100-nanosecond steps since 1601. */
const EPOCH_TICKS = 116444736000000000n;

/** A GUID as the 16 bytes Windows wants. */
export function guidBytes(text: string): Buffer {
  const hex = text.replace(/-/g, "");
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32LE(Number.parseInt(hex.slice(0, 8), 16), 0);
  bytes.writeUInt16LE(Number.parseInt(hex.slice(8, 12), 16), 4);
  bytes.writeUInt16LE(Number.parseInt(hex.slice(12, 16), 16), 6);
  Buffer.from(hex.slice(16), "hex").copy(bytes, 8);
  return bytes;
}

/** A time in milliseconds since 1970 as Windows' DateTime. */
export function dateTime(ms: number): bigint {
  return BigInt(Math.round(ms)) * 10000n + EPOCH_TICKS;
}

type Method = (...args: unknown[]) => number;

interface Native {
  /** The function in slot `slot` of a COM object's table. */
  method(object: unknown, slot: number, proto: unknown): Method;
  release(object: unknown): void;
  protos: Record<"queryInterface" | "getObject" | "getUint32" | "getUint64" | "getAt" | "networkUsage", unknown>;
  /** INetworkInformationStatics, kept for the worker's life. */
  statics: unknown;
}

function loadNative(): Native {
  // Outside the bundle (scripts/targets.mjs): koffi loads a native file next to it in node_modules.
  const koffi = require("koffi") as typeof import("koffi");
  const combase = koffi.load("combase.dll");
  const roInitialize = combase.func("long __stdcall RoInitialize(int type)");
  const createString = combase.func("long __stdcall WindowsCreateString(str16 text, uint32_t length, _Out_ void **string)");
  const deleteString = combase.func("long __stdcall WindowsDeleteString(void *string)");
  const activationFactory = combase.func("long __stdcall RoGetActivationFactory(void *classId, const uint8_t *iid, _Out_ void **factory)");
  // koffi keeps type names for the whole process (DXGI already has a "Release"), so these carry a prefix.
  const releaseProto = koffi.proto("uint32_t __stdcall TrafficRelease(void *self)");
  const method = (object: unknown, slot: number, proto: unknown) => {
    const table = koffi.decode(koffi.decode(object, "void *"), "void *[16]") as unknown[];
    return koffi.decode(table[slot], proto as never) as Method;
  };
  const release = (object: unknown) => {
    if (object) method(object, 2, releaseProto)(object);
  };

  const init = roInitialize(RO_INIT_MULTITHREADED) as number;
  if (init < 0 && init !== RPC_E_CHANGED_MODE) throw new Error(`RoInitialize failed (0x${(init >>> 0).toString(16)})`);
  const name = "Windows.Networking.Connectivity.NetworkInformation";
  const classId = [null as unknown];
  check(createString(name, name.length, classId) as number, "WindowsCreateString");
  const statics = [null as unknown];
  try {
    check(activationFactory(classId[0], guidBytes(IID_NETWORK_INFORMATION_STATICS), statics) as number, "RoGetActivationFactory");
  } finally {
    deleteString(classId[0]);
  }
  return {
    method,
    release,
    statics: statics[0],
    protos: {
      queryInterface: koffi.proto("long __stdcall TrafficQueryInterface(void *self, const uint8_t *iid, _Out_ void **object)"),
      getObject: koffi.proto("long __stdcall TrafficGetObject(void *self, _Out_ void **object)"),
      getUint32: koffi.proto("long __stdcall TrafficGetUint32(void *self, _Out_ uint32_t *value)"),
      getUint64: koffi.proto("long __stdcall TrafficGetUint64(void *self, _Out_ uint64_t *value)"),
      getAt: koffi.proto("long __stdcall TrafficGetAt(void *self, uint32_t index, _Out_ void **object)"),
      // DateTime is one 64-bit number; NetworkUsageStates is two 32-bit "don't care"s, passed as one 64-bit 0.
      networkUsage: koffi.proto("long __stdcall TrafficGetNetworkUsageAsync(void *self, int64_t start, int64_t end, int granularity, uint64_t states, _Out_ void **operation)"),
    },
  };
}

function check(result: number, what: string): void {
  if (result < 0) throw new Error(`${what} failed (0x${(result >>> 0).toString(16)})`);
}

/**
 * Table slots, after IInspectable's 6 (QueryInterface 0, AddRef 1, Release 2, GetIids, GetRuntimeClassName, GetTrustLevel):
 * INetworkInformationStatics.GetConnectionProfiles 6; IVectorView GetAt 6 and get_Size 7; IConnectionProfile
 * get_NetworkAdapter 11; INetworkAdapter get_IanaInterfaceType 8; IConnectionProfile2 GetNetworkUsageAsync 13;
 * IAsyncInfo get_Status 7; IAsyncOperation GetResults 8; INetworkUsage get_BytesSent 6 and get_BytesReceived 7.
 */
const SLOT = { profiles: 6, getAt: 6, size: 7, adapter: 11, ianaType: 8, networkUsage: 13, status: 7, results: 8, sent: 6, received: 7 } as const;

/** One question to Windows still out. */
interface Question {
  operation: unknown;
  info: unknown;
  range: number;
}

/** The reader for this PC. Each read asks Windows once per network and range, all at the same time. */
export function windowsTrafficReader(loader: () => Native = loadNative): TrafficReader {
  let native: Native | null = null;
  let failure: unknown = null;
  const load = (): Native => {
    if (failure) throw failure;
    try {
      return (native ??= loader());
    } catch (error) {
      failure = error;
      throw error;
    }
  };

  return async (ranges: TrafficRange[]) => {
    const n = load();
    const { method, release, protos } = n;
    const profiles: unknown[] = [];
    const questions: Question[] = [];
    try {
      const list = [null as unknown];
      check(method(n.statics, SLOT.profiles, protos.getObject)(n.statics, list), "GetConnectionProfiles");
      try {
        const size = [0];
        check(method(list[0], SLOT.size, protos.getUint32)(list[0], size), "get_Size");
        for (let index = 0; index < size[0]!; index++) {
          const profile = [null as unknown];
          if (method(list[0], SLOT.getAt, protos.getAt)(list[0], index, profile) < 0 || !profile[0]) continue;
          try {
            if (isVirtual(n, profile[0])) continue;
            const second = [null as unknown];
            if (method(profile[0], 0, protos.queryInterface)(profile[0], guidBytes(IID_CONNECTION_PROFILE_2), second) >= 0 && second[0]) profiles.push(second[0]);
          } finally {
            release(profile[0]);
          }
        }
      } finally {
        release(list[0]);
      }

      for (const [range, { from, to }] of ranges.entries()) {
        for (const profile of profiles) {
          const operation = [null as unknown];
          check(method(profile, SLOT.networkUsage, protos.networkUsage)(profile, dateTime(from), dateTime(to), GRANULARITY_TOTAL, 0n, operation), "GetNetworkUsageAsync");
          const info = [null as unknown];
          const asked = method(operation[0], 0, protos.queryInterface)(operation[0], guidBytes(IID_ASYNC_INFO), info);
          questions.push({ operation: operation[0], info: info[0], range });
          check(asked, "IAsyncInfo");
        }
      }

      const sums: ({ down: bigint; up: bigint } | null)[] = ranges.map(() => null);
      const started = Date.now();
      for (const question of questions) {
        const status = [STARTED];
        for (;;) {
          check(method(question.info, SLOT.status, protos.getUint32)(question.info, status), "get_Status");
          if (status[0] !== STARTED) break;
          if (Date.now() - started > TIMEOUT_MS) throw new Error("Windows took too long to answer");
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        if (status[0] !== COMPLETED) throw new Error(`Windows could not read the traffic (status ${status[0]})`);
        const usages = [null as unknown];
        check(method(question.operation, SLOT.results, protos.getObject)(question.operation, usages), "GetResults");
        try {
          const count = [0];
          check(method(usages[0], SLOT.size, protos.getUint32)(usages[0], count), "get_Size");
          // No entry at all is a range Windows has no record of; an entry of 0 bytes is a network that wasn't used.
          for (let index = 0; index < count[0]!; index++) {
            const usage = [null as unknown];
            check(method(usages[0], SLOT.getAt, protos.getAt)(usages[0], index, usage), "GetAt");
            try {
              const sent = [0n];
              const received = [0n];
              check(method(usage[0], SLOT.sent, protos.getUint64)(usage[0], sent), "get_BytesSent");
              check(method(usage[0], SLOT.received, protos.getUint64)(usage[0], received), "get_BytesReceived");
              const sum = (sums[question.range] ??= { down: 0n, up: 0n });
              sum.down += BigInt(received[0]!);
              sum.up += BigInt(sent[0]!);
            } finally {
              release(usage[0]);
            }
          }
        } finally {
          release(usages[0]);
        }
      }
      return sums.map((sum): TrafficBytes | null => (sum ? { downBytes: Number(sum.down), upBytes: Number(sum.up) } : null));
    } finally {
      for (const question of questions) {
        release(question.info);
        release(question.operation);
      }
      for (const profile of profiles) release(profile);
    }
  };
}

/** Whether a profile's adapter is a virtual one. A profile without an adapter (a network not connected now) is real. */
function isVirtual(n: Native, profile: unknown): boolean {
  const adapter = [null as unknown];
  if (n.method(profile, SLOT.adapter, n.protos.getObject)(profile, adapter) < 0 || !adapter[0]) return false;
  try {
    const type = [0];
    return n.method(adapter[0], SLOT.ianaType, n.protos.getUint32)(adapter[0], type) >= 0 && VIRTUAL_TYPES.has(type[0]!);
  } finally {
    n.release(adapter[0]);
  }
}

/** The reader for this PC; elsewhere there is no record to read. */
export function trafficReader(): TrafficReader {
  return process.platform === "win32" ? windowsTrafficReader() : (ranges) => Promise.resolve(ranges.map(() => null));
}
