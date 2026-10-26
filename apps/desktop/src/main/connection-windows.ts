/**
 * Looks at this PC's network for the connection watcher (connection.ts), straight from Windows inside Tavora's own
 * process, through iphlpapi.dll: an ICMP echo (the "ping" Windows has, `IcmpSendEcho`), the route to the internet
 * (`GetBestRoute2`, whose next hop is the router), the adapter's byte counters (`GetIfEntry2`) and what Windows thinks
 * about being online (`GetNetworkConnectivityHint`). No helper program, no ping.exe, no WMI and nothing that needs
 * admin rights. Echoes run on koffi's worker threads, so the main thread never waits for one. Windows only: koffi is
 * loaded on the first look, never elsewhere.
 */
import dns from "node:dns";
import { parseIpv4 } from "./system-info-parse";
import type { ConnectionProbe, LocalNetwork } from "./connection";

const AF_INET = 2;
const IP_SUCCESS = 0;
/** NL_NETWORK_CONNECTIVITY_LEVEL_HINT: 1 is NetworkConnectivityLevelHintNone. */
const LEVEL_NONE = 1;
/** Windows asks the name server this long at most. */
const RESOLVE_TIMEOUT_MS = 2000;

/** MIB_IPFORWARD_ROW2: the interface index is at 8 and the next hop (a SOCKADDR_INET, address from byte 4) at 44. */
const ROUTE_BYTES = 104;
const ROUTE_INDEX = 8;
const ROUTE_NEXT_HOP = 44;
/** MIB_IF_ROW2 is 1352 bytes: the interface index at 8, InOctets at 1208 and OutOctets at 1280. */
const IF_ROW_BYTES = 1352;
const IF_INDEX = 8;
const IF_IN_OCTETS = 1208;
const IF_OUT_OCTETS = 1280;
/** ICMP_ECHO_REPLY: the address, then the status and the round trip time, 4 bytes each. */
const REPLY_BYTES = 256;
const REPLY_STATUS = 4;
const REPLY_TIME = 8;
/** The address the route to the internet is asked for. */
const ROUTE_TARGET = [1, 1, 1, 1] as const;

interface Native {
  icmpCreate: () => unknown;
  icmpClose: (handle: unknown) => number;
  icmpSend: {
    (handle: unknown, address: number, data: Buffer, size: number, options: null, reply: Buffer, replySize: number, timeout: number): number;
    async: (handle: unknown, address: number, data: Buffer, size: number, options: null, reply: Buffer, replySize: number, timeout: number, done: (error: Error | null, count: number) => void) => void;
  };
  bestRoute: (luid: null, index: number, source: null, destination: Buffer, options: number, route: Buffer, bestSource: Buffer) => number;
  ifEntry: (row: Buffer) => number;
  /** Null on a Windows without it (before Windows 10 version 2004): the pings alone tell then. */
  hint: ((hint: Buffer) => number) | null;
}

/** The part of koffi this file uses, so a test can stand in for it. */
type Koffi = Pick<typeof import("koffi"), "load">;

export function loadNative(koffi: Koffi = require("koffi") as typeof import("koffi")): Native {
  const iphlpapi = koffi.load("iphlpapi.dll");
  let hint: Native["hint"] = null;
  try {
    hint = iphlpapi.func("uint32_t __stdcall GetNetworkConnectivityHint(_Out_ uint8_t *hint)") as Native["hint"];
  } catch {
    // An older Windows has no such function; everything else still works.
  }
  return {
    icmpCreate: iphlpapi.func("void *__stdcall IcmpCreateFile()"),
    icmpClose: iphlpapi.func("int __stdcall IcmpCloseHandle(void *handle)"),
    icmpSend: iphlpapi.func(
      "uint32_t __stdcall IcmpSendEcho(void *handle, uint32_t address, void *data, uint16_t size, void *options, _Out_ uint8_t *reply, uint32_t replySize, uint32_t timeout)",
    ) as Native["icmpSend"],
    bestRoute: iphlpapi.func("uint32_t __stdcall GetBestRoute2(void *luid, uint32_t index, void *source, void *destination, uint32_t options, _Out_ uint8_t *route, _Out_ uint8_t *bestSource)"),
    ifEntry: iphlpapi.func("uint32_t __stdcall GetIfEntry2(_Inout_ uint8_t *row)"),
    hint,
  };
}

/** The IPv4 address as the number IcmpSendEcho wants: the bytes in the order of the text, the first one lowest. */
export function icmpAddress(ip: string): number | null {
  const parts = parseIpv4(ip);
  return parts ? (parts[0] | (parts[1] << 8) | (parts[2] << 16) | (parts[3] << 24)) >>> 0 : null;
}

/**
 * A probe for this PC. Throws on the looks when Windows' functions can't be loaded; the loading is tried once, not
 * every 5 seconds.
 */
export function windowsConnectionProbe(loader: () => Native = loadNative): ConnectionProbe {
  let native: Native | null = null;
  let failure: unknown = null;
  let hintBroken = false;
  /** Echoes still out, and whether a name is being looked up (the lookup waits on a thread of Node's small pool). */
  let echoes = 0;
  let looking = false;
  const load = (): Native => {
    if (failure) throw failure;
    try {
      return (native ??= loader());
    } catch (error) {
      failure = error;
      throw error;
    }
  };
  /** One handle and one reply buffer for each channel, so the two echoes at once never share anything. */
  const channels = new Map<string, { handle: unknown; reply: Buffer }>();
  const data = Buffer.alloc(32, 0x61);
  const destination = Buffer.alloc(28);
  destination.writeUInt16LE(AF_INET, 0);
  Buffer.from(ROUTE_TARGET).copy(destination, 4);

  function channel(name: string) {
    let found = channels.get(name);
    if (!found) {
      const handle = load().icmpCreate();
      if (!handle || isInvalidHandle(handle)) throw new Error("could not open an ICMP handle");
      channels.set(name, (found = { handle, reply: Buffer.alloc(REPLY_BYTES) }));
    }
    return found;
  }

  return {
    local(): LocalNetwork {
      const n = load();
      let windowsOffline = false;
      if (n.hint && !hintBroken) {
        const hint = Buffer.alloc(16);
        try {
          if (n.hint(hint) === 0) windowsOffline = hint.readUInt32LE(0) === LEVEL_NONE;
          else hintBroken = true;
        } catch {
          hintBroken = true;
        }
      }
      const route = Buffer.alloc(ROUTE_BYTES);
      if (n.bestRoute(null, 0, null, destination, 0, route, Buffer.alloc(28)) !== 0) return { windowsOffline, gateway: null, adapter: null };
      const index = route.readUInt32LE(ROUTE_INDEX);
      // A next hop of 0.0.0.0 (or not IPv4) is the route being on-link: no router to ask.
      const family = route.readUInt16LE(ROUTE_NEXT_HOP);
      const hop = route.subarray(ROUTE_NEXT_HOP + 4, ROUTE_NEXT_HOP + 8);
      const gateway = family === AF_INET && hop.some((byte) => byte !== 0) ? [...hop].join(".") : null;
      const row = Buffer.alloc(IF_ROW_BYTES);
      row.writeUInt32LE(index, IF_INDEX);
      const adapter = n.ifEntry(row) === 0 ? { index, bytesIn: Number(row.readBigUInt64LE(IF_IN_OCTETS)), bytesOut: Number(row.readBigUInt64LE(IF_OUT_OCTETS)) } : null;
      return { windowsOffline, gateway, adapter };
    },

    ping(name, address, timeoutMs) {
      return new Promise<number | null>((resolve) => {
        try {
          const target = icmpAddress(address);
          if (target === null) return resolve(null);
          const { handle, reply } = channel(name);
          reply.fill(0);
          load().icmpSend.async(handle, target, data, data.length, null, reply, reply.length, timeoutMs, (error, count) => {
            echoes--;
            if (error || count < 1 || reply.readUInt32LE(REPLY_STATUS) !== IP_SUCCESS) return resolve(null);
            resolve(reply.readUInt32LE(REPLY_TIME));
          });
          echoes++;
        } catch {
          resolve(null);
        }
      });
    },

    resolve(name) {
      return new Promise<string | null>((resolve) => {
        // One lookup at a time: a name server that hangs holds one thread of the pool, never all of them.
        if (looking) return resolve(null);
        looking = true;
        const timer = setTimeout(() => resolve(null), RESOLVE_TIMEOUT_MS);
        timer.unref?.();
        dns.promises
          .lookup(name, { family: 4 })
          .then((found) => resolve(found.address))
          .catch(() => resolve(null))
          .finally(() => {
            clearTimeout(timer);
            looking = false;
          });
      });
    },

    close() {
      // An echo still out is left to finish: closing its handle under it is not safe, and Tavora is closing anyway.
      if (echoes > 0) return;
      for (const { handle } of channels.values()) {
        try {
          load().icmpClose(handle);
        } catch {
          // Nothing more to do with it.
        }
      }
      channels.clear();
    },
  };
}

/** IcmpCreateFile gives INVALID_HANDLE_VALUE (all bits set) when it fails. */
function isInvalidHandle(handle: unknown): boolean {
  const koffi = require("koffi") as typeof import("koffi");
  try {
    return koffi.address(handle as never) === 0xffffffffffffffffn;
  } catch {
    return false;
  }
}

/** A probe for a PC that isn't Windows: nothing to look at. */
export function unsupportedConnectionProbe(): ConnectionProbe {
  return {
    local: () => ({ windowsOffline: false, gateway: null, adapter: null }),
    ping: () => Promise.resolve(null),
    resolve: () => Promise.resolve(null),
    close: () => undefined,
  };
}

/** The probe for this PC. */
export function connectionProbe(): ConnectionProbe {
  return process.platform === "win32" ? windowsConnectionProbe() : unsupportedConnectionProbe();
}
