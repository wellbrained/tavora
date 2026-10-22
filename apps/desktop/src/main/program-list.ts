/**
 * Reads the running programs and Steam's running game straight from Windows, inside Tavora's own process
 * (game-watch.ts). It asks Windows only for each program's path, with the same limited access Task Manager
 * uses, and reads one registry value. Windows only: koffi is loaded on the first look, never elsewhere.
 */

/** One look at this PC. */
export interface ProgramLook {
  /** Running programs by process id: their full paths. */
  programs: Map<number, string>;
  /** The game Steam runs, or null for none. */
  steamAppId: number | null;
}

/** Takes one look; a program seen in the last look keeps its path without asking Windows again. */
export type ProgramProbe = () => ProgramLook;

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
/** HKEY_CURRENT_USER, the predefined handle sign-extended as Windows does. */
const HKEY_CURRENT_USER = -0x7fffffff;
const RRF_RT_REG_DWORD = 0x10;

interface Windows {
  enumProcesses: (pids: Uint32Array, bytes: number, needed: number[]) => number;
  openProcess: (access: number, inherit: number, pid: number) => bigint | null;
  queryFullProcessImageName: (process: bigint, flags: number, name: Uint16Array, size: number[]) => number;
  closeHandle: (handle: bigint) => number;
  regGetValue: (key: number, subKey: string, value: string, flags: number, type: null, data: number[], size: number[]) => number;
}

function loadWindows(): Windows {
  // Outside the bundle (scripts/targets.mjs): koffi loads a native file next to it in node_modules.
  const koffi = require("koffi") as typeof import("koffi");
  const kernel32 = koffi.load("kernel32.dll");
  const advapi32 = koffi.load("advapi32.dll");
  return {
    enumProcesses: kernel32.func("int __stdcall K32EnumProcesses(_Out_ uint32_t *pids, uint32_t bytes, _Out_ uint32_t *needed)"),
    openProcess: kernel32.func("void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)"),
    queryFullProcessImageName: kernel32.func("int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ uint16_t *name, _Inout_ uint32_t *size)"),
    closeHandle: kernel32.func("int __stdcall CloseHandle(void *handle)"),
    regGetValue: advapi32.func(
      "long __stdcall RegGetValueW(intptr_t key, str16 subKey, str16 value, uint32_t flags, _Out_ uint32_t *type, _Out_ uint32_t *data, _Inout_ uint32_t *size)",
    ),
  };
}

function processIds(windows: Windows): Uint32Array {
  for (let size = 4096; ; size *= 2) {
    const pids = new Uint32Array(size);
    const needed = [0];
    if (!windows.enumProcesses(pids, pids.byteLength, needed)) return new Uint32Array();
    // A full buffer may have cut the list short.
    if (needed[0]! < pids.byteLength) return pids.subarray(0, needed[0]! / 4);
  }
}

function programPath(windows: Windows, pid: number, name: Uint16Array): string | null {
  const process = windows.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!process) return null;
  try {
    const size = [name.length];
    return windows.queryFullProcessImageName(process, 0, name, size) ? Buffer.from(name.buffer, 0, size[0]! * 2).toString("utf16le") : null;
  } finally {
    windows.closeHandle(process);
  }
}

function steamGame(windows: Windows): number | null {
  const data = [0];
  const result = windows.regGetValue(HKEY_CURRENT_USER, "Software\\Valve\\Steam", "RunningAppID", RRF_RT_REG_DWORD, null, data, [4]);
  return result === 0 && data[0]! > 0 ? data[0]! : null;
}

/** A probe for this PC. Throws on the first look when Windows' functions can't be loaded. */
export function windowsProgramProbe(): ProgramProbe {
  let windows: Windows | null = null;
  let known = new Map<number, string>();
  const name = new Uint16Array(1024);
  return () => {
    windows ??= loadWindows();
    const now = new Map<number, string>();
    for (const pid of processIds(windows)) {
      const file = known.get(pid) ?? programPath(windows, pid, name);
      if (file) now.set(pid, file);
    }
    known = now;
    return { programs: now, steamAppId: steamGame(windows) };
  };
}
