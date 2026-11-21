import { readProcesses, type ProcessEntry } from "./system-apps";

/**
 * Reads the running programs and Steam's running game straight from Windows, inside Tavora's own process
 * (game-watch.ts). Windows' list of processes (system-apps.ts) opens none of them. Only a process not seen before is
 * asked for its path, once in its life, with the same limited access Task Manager uses. A protected process that says
 * no is not asked again, so a game and its anti-cheat see at most one request. One registry value is read too. Windows
 * only: koffi is loaded on the first look, never elsewhere.
 */

/** One look at this PC. */
export interface ProgramLook {
  /** Running programs by process id: their full paths. */
  programs: Map<number, string>;
  /** The game Steam runs, or null for none. */
  steamAppId: number | null;
}

/** Takes one look; a process seen before keeps what Windows said about it, without being asked again. */
export type ProgramProbe = () => ProgramLook;

/** A process in Windows' list: its id and when it started, since Windows gives the id of one that ended to a new one. */
export type ListedProcess = Pick<ProcessEntry, "pid" | "startTime">;

/** What Windows said about each process seen last, by id and start time: its path, or null when it wouldn't say. */
export type KnownPrograms = ReadonlyMap<string, string | null>;

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
/** HKEY_CURRENT_USER, the predefined handle sign-extended as Windows does. */
const HKEY_CURRENT_USER = -0x7fffffff;
const RRF_RT_REG_DWORD = 0x10;

export interface Windows {
  openProcess: (access: number, inherit: number, pid: number) => bigint | null;
  queryFullProcessImageName: (process: bigint, flags: number, name: Uint16Array, size: number[]) => number;
  closeHandle: (handle: bigint) => number;
  regGetValue: (key: number, subKey: string, value: string, flags: number, type: null, data: number[], size: number[]) => number;
}

export function loadWindows(): Windows {
  // Outside the bundle (scripts/targets.mjs): koffi loads a native file next to it in node_modules.
  const koffi = require("koffi") as typeof import("koffi");
  const kernel32 = koffi.load("kernel32.dll");
  const advapi32 = koffi.load("advapi32.dll");
  return {
    openProcess: kernel32.func("void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)"),
    queryFullProcessImageName: kernel32.func("int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ uint16_t *name, _Inout_ uint32_t *size)"),
    closeHandle: kernel32.func("int __stdcall CloseHandle(void *handle)"),
    regGetValue: advapi32.func(
      "long __stdcall RegGetValueW(intptr_t key, str16 subKey, str16 value, uint32_t flags, _Out_ uint32_t *type, _Out_ uint32_t *data, _Inout_ uint32_t *size)",
    ),
  };
}

export function programPath(windows: Windows, pid: number, name: Uint16Array): string | null {
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

/**
 * The running programs from Windows' list. `askPath` runs only for a process not seen before: one that said no stays
 * known as such, and a new process on a reused id is a new process. System Idle (0) and System (4) have no program.
 */
export function nextPrograms(listed: readonly ListedProcess[], known: KnownPrograms, askPath: (pid: number) => string | null): { programs: Map<number, string>; known: Map<string, string | null> } {
  const programs = new Map<number, string>();
  const now = new Map<string, string | null>();
  for (const { pid, startTime } of listed) {
    if (pid === 0 || pid === 4) continue;
    const key = `${pid}:${startTime}`;
    const file = known.has(key) ? known.get(key)! : askPath(pid);
    now.set(key, file);
    if (file) programs.set(pid, file);
  }
  return { programs, known: now };
}

/**
 * A probe for this PC. Throws on the first look when Windows' functions can't be loaded. A later look whose list fails
 * (it kept growing, say) keeps the programs seen last, so the game watcher goes on.
 */
export function windowsProgramProbe(list: () => readonly ListedProcess[] = readProcesses, load: () => Windows = loadWindows): ProgramProbe {
  let windows: Windows | null = null;
  let known: KnownPrograms = new Map();
  let programs: Map<number, string> | null = null;
  const name = new Uint16Array(1024);
  return () => {
    const system = (windows ??= load());
    let listed: readonly ListedProcess[];
    try {
      listed = list();
    } catch (error) {
      if (!programs) throw error;
      return { programs, steamAppId: steamGame(system) };
    }
    const next = nextPrograms(listed, known, (pid) => programPath(system, pid, name));
    known = next.known;
    programs = next.programs;
    return { programs, steamAppId: steamGame(system) };
  };
}
