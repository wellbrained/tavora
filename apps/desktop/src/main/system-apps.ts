/**
 * The apps running on this PC and how much memory and CPU each takes, for Tavora's own System Monitor only
 * (systemInfo.apps). One call into Windows lists every process with its numbers: NtQuerySystemInformation with
 * SystemProcessInformation, the list Task Manager reads too. It opens no handle to any process, so a game and its
 * anti-cheat are never touched; the price is that only the file name is known, never a path or an icon. Read in the
 * system-info worker, only while the System Monitor's apps dialog asks.
 */
import os from "node:os";
import type { SystemApp, SystemApps } from "@tavora/sdk/protocol";
import { OFFICIAL_OWNER } from "@tavora/module-schema";
import { HostError } from "./errors";

/** The official System Monitor, the only module that may list the apps. */
export const SYSTEM_MONITOR_ID = "tavora.system-monitor";

/** What else runs on the PC is not for every module granted System info: only for Tavora's own System Monitor. */
export function onlySystemMonitor(owner: string, id: string, what: string): void {
  if (owner !== OFFICIAL_OWNER || id !== SYSTEM_MONITOR_ID) throw new HostError("PERMISSION_DENIED", `${what} is only for Tavora's own System Monitor`);
}

/** One process as Windows lists it. */
export interface ProcessEntry {
  pid: number;
  /** The file name ("firefox.exe"), or a name Windows gives its own ("Memory Compression"). */
  name: string;
  /** The private working set: memory only this process uses, Task Manager's Memory column. */
  privateBytes: number;
  /** CPU time used since it started, in 100-nanosecond units. */
  cpuTime: number;
}

/** Windows' own processes, by file name without ".exe" in lower case. They get the Windows mark. */
const WINDOWS_NAMES = new Set([
  "system", "secure system", "registry", "memory compression", "smss", "csrss", "wininit", "winlogon", "services",
  "lsass", "lsaiso", "svchost", "fontdrvhost", "dwm", "explorer", "sihost", "taskhostw", "ctfmon", "runtimebroker",
  "searchhost", "searchindexer", "searchprotocolhost", "searchfilterhost", "startmenuexperiencehost",
  "shellexperiencehost", "shellhost", "textinputhost", "applicationframehost", "dllhost", "conhost", "spoolsv",
  "wudfhost", "audiodg", "smartscreen", "securityhealthservice", "securityhealthsystray", "msmpeng", "nissrv",
  "mpdefendercoreservice", "wmiprvse", "lockapp", "systemsettings", "widgets", "widgetservice", "dashost", "unsecapp",
  "sgrmbroker", "useroobebroker", "backgroundtaskhost", "compattelrunner", "wlanext", "ngciso", "lsm", "taskmgr",
  "dataexchangehost", "gamebar", "gamebarftserver", "gameinputsvc", "msedgewebview2", "crossdeviceservice",
]);

const stripExe = (name: string) => name.replace(/\.exe$/i, "");

/** The name the list shows: without ".exe" and with a capital first letter ("firefox.exe" → "Firefox"). */
export function appName(name: string): string {
  const bare = stripExe(name);
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

export const isWindowsProcess = (name: string) => WINDOWS_NAMES.has(stripExe(name).toLowerCase());

/**
 * Groups processes into apps by name and works out each app's CPU since the last reading, as a share of the whole
 * PC like Task Manager. The first reading has no CPU yet (null); the worker takes two a moment apart then.
 */
export class AppsReader {
  private last = new Map<number, { name: string; cpuTime: number }>();
  private lastAt = 0;

  private readonly threads: number;

  constructor(threads = os.availableParallelism()) {
    this.threads = Math.max(1, threads);
  }

  /** How long ago the last reading was, in milliseconds; Infinity before the first. */
  age(now: number): number {
    return this.lastAt ? now - this.lastAt : Infinity;
  }

  read(entries: readonly ProcessEntry[], now: number, usedBytes: number): SystemApps {
    const elapsed = this.lastAt ? (now - this.lastAt) * 10_000 * this.threads : 0;
    const apps = new Map<string, SystemApp>();
    const seen = new Map<number, { name: string; cpuTime: number }>();
    for (const entry of entries) {
      // PID 0 is the Idle process: its "CPU" is the time nothing ran.
      if (entry.pid === 0 || !entry.name) continue;
      seen.set(entry.pid, { name: entry.name, cpuTime: entry.cpuTime });
      const key = stripExe(entry.name).toLowerCase();
      let app = apps.get(key);
      if (!app) {
        app = { name: appName(entry.name), memoryBytes: 0, cpu: elapsed > 0 ? 0 : null, windows: isWindowsProcess(entry.name) };
        apps.set(key, app);
      }
      app.memoryBytes += Math.max(0, entry.privateBytes);
      const before = this.last.get(entry.pid);
      // A PID Windows gave to a new process counts from nothing only when the name matches; else from its start.
      if (app.cpu !== null && before && before.name === entry.name) app.cpu += Math.max(0, entry.cpuTime - before.cpuTime);
    }
    this.last = seen;
    this.lastAt = now;
    const list = [...apps.values()];
    for (const app of list) if (app.cpu !== null) app.cpu = Math.min(100, Math.round((app.cpu / elapsed) * 1000) / 10);
    list.sort((a, b) => b.memoryBytes - a.memoryBytes);
    return { apps: list, usedBytes: Math.max(0, usedBytes) };
  }
}

/* ---------------------------------------------------------------- Windows ---------------------------------------------------------------- */

const SYSTEM_PROCESS_INFORMATION = 5;
const STATUS_INFO_LENGTH_MISMATCH = 0xc0000004 | 0;

/** Offsets in SYSTEM_PROCESS_INFORMATION on 64-bit Windows. */
const OFFSET = { next: 0, privateWorkingSet: 8, userTime: 40, kernelTime: 48, nameLength: 56, nameBuffer: 64, pid: 80 } as const;

/** Reads one SystemProcessInformation buffer that starts at address `base`. Names point into the same buffer. */
export function parseProcesses(buffer: Buffer, base: bigint): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  let at = 0;
  for (;;) {
    if (at + OFFSET.pid + 8 > buffer.length) break;
    const length = buffer.readUInt16LE(at + OFFSET.nameLength);
    const inside = Number(buffer.readBigUInt64LE(at + OFFSET.nameBuffer) - base);
    const pid = Number(buffer.readBigUInt64LE(at + OFFSET.pid));
    let name = length > 0 && inside >= 0 && inside + length <= buffer.length ? buffer.toString("utf16le", inside, inside + length) : "";
    // Windows gives the System process no name; Task Manager calls it System.
    if (pid === 4 && !name) name = "System";
    entries.push({
      pid,
      name,
      privateBytes: Number(buffer.readBigInt64LE(at + OFFSET.privateWorkingSet)),
      cpuTime: Number(buffer.readBigInt64LE(at + OFFSET.userTime) + buffer.readBigInt64LE(at + OFFSET.kernelTime)),
    });
    const next = buffer.readUInt32LE(at + OFFSET.next);
    if (next === 0) break;
    at += next;
  }
  return entries;
}

interface Native {
  koffi: typeof import("koffi");
  query: (kind: number, buffer: unknown, size: number, needed: number[]) => number;
}

let native: Native | null = null;

function loadNative(): Native {
  if (native) return native;
  // Outside the bundle (scripts/targets.mjs): koffi loads a native file next to it in node_modules.
  const koffi = require("koffi") as typeof import("koffi");
  const ntdll = koffi.load("ntdll.dll");
  native = { koffi, query: ntdll.func("long __stdcall NtQuerySystemInformation(int kind, void *buffer, uint32_t size, _Out_ uint32_t *needed)") };
  return native;
}

let size = 512 * 1024;

/** Every process now, with one call into Windows (two when the buffer was too small). Windows only. */
export function readProcesses(): ProcessEntry[] {
  const { koffi, query } = loadNative();
  for (let tries = 0; tries < 4; tries++) {
    const memory = koffi.alloc("uint8_t", size);
    try {
      const needed = [0];
      const status = query(SYSTEM_PROCESS_INFORMATION, memory, size, needed);
      if (status === STATUS_INFO_LENGTH_MISMATCH) {
        // More processes started in between: leave some room.
        size = Math.max(size * 2, (needed[0] ?? 0) + 64 * 1024);
        continue;
      }
      if (status < 0) throw new Error(`NtQuerySystemInformation failed (0x${(status >>> 0).toString(16)})`);
      // A copy, decoded while the memory is still ours. A view straight into it (koffi.view) would crash Electron,
      // which allows no ArrayBuffer outside its own memory.
      const bytes = koffi.decode(memory, koffi.array("uint8_t", size, "Typed")) as Uint8Array;
      return parseProcesses(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), koffi.address(memory));
    } finally {
      koffi.free(memory);
    }
  }
  throw new Error("the process list kept growing");
}
