import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { nextPrograms, programPath, windowsProgramProbe, type ListedProcess, type Windows } from "./program-list";

// Ban safety: Tavora only reads a program's path, with limited rights, and never touches another process.
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

function windows(overrides: Partial<Windows> = {}) {
  const calls: string[] = [];
  const fake: Windows = {
    openProcess: vi.fn(() => {
      calls.push("open");
      return 7n;
    }),
    queryFullProcessImageName: vi.fn((_process, _flags, name: Uint16Array, size: number[]) => {
      calls.push("query");
      for (const [index, char] of [..."C:/a.exe"].entries()) name[index] = char.charCodeAt(0);
      size[0] = 8;
      return 1;
    }),
    closeHandle: vi.fn(() => {
      calls.push("close");
      return 1;
    }),
    regGetValue: vi.fn(() => 1),
    ...overrides,
  };
  return { fake, calls };
}

describe("looking at a program", () => {
  it("opens it with limited query rights only, and closes it again", () => {
    const { fake, calls } = windows();
    expect(programPath(fake, 1234, new Uint16Array(1024))).toBe("C:/a.exe");
    expect(fake.openProcess).toHaveBeenCalledTimes(1);
    // Exactly the limited right: no read, write or other access mixed in, and the handle is not inherited.
    expect(fake.openProcess).toHaveBeenCalledWith(PROCESS_QUERY_LIMITED_INFORMATION, 0, 1234);
    expect(calls).toEqual(["open", "query", "close"]);
  });

  it("closes the handle when the path can't be read", () => {
    const { fake } = windows({ queryFullProcessImageName: vi.fn(() => 0) });
    expect(programPath(fake, 1, new Uint16Array(8))).toBeNull();
    expect(fake.closeHandle).toHaveBeenCalledWith(7n);
  });

  it("gives up quietly on a program it may not open", () => {
    const { fake } = windows({ openProcess: vi.fn(() => null) });
    expect(programPath(fake, 1, new Uint16Array(8))).toBeNull();
    expect(fake.queryFullProcessImageName).not.toHaveBeenCalled();
  });
});

describe("looking again and again", () => {
  const process = (pid: number, startTime = 100): ListedProcess => ({ pid, startTime });

  it("asks about each process once, however many looks it stays", () => {
    const ask = vi.fn((pid: number) => `C:/p${pid}.exe`);
    let state = nextPrograms([process(10), process(11)], new Map(), ask);
    for (let look = 0; look < 5; look += 1) state = nextPrograms([process(10), process(11)], state.known, ask);
    expect(ask).toHaveBeenCalledTimes(2);
    expect([...state.programs.values()]).toEqual(["C:/p10.exe", "C:/p11.exe"]);
  });

  it("never asks a process that said no again (ban safety)", () => {
    const ask = vi.fn(() => null);
    let state = nextPrograms([process(66)], new Map(), ask);
    for (let look = 0; look < 100; look += 1) state = nextPrograms([process(66)], state.known, ask);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(state.programs.size).toBe(0);
  });

  it("doesn't take a new process on a reused id for the one that ended", () => {
    const ask = vi.fn((pid: number) => (ask.mock.calls.length === 1 ? `C:/game${pid}.exe` : "C:/notepad.exe"));
    const first = nextPrograms([process(10, 100)], new Map(), ask);
    expect(first.programs.get(10)).toBe("C:/game10.exe");
    const reused = nextPrograms([process(10, 200)], first.known, ask);
    expect(reused.programs.get(10)).toBe("C:/notepad.exe");
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("forgets a process that ended", () => {
    const ask = vi.fn(() => "C:/a.exe");
    const first = nextPrograms([process(10)], new Map(), ask);
    expect(nextPrograms([], first.known, ask).known.size).toBe(0);
  });

  it("leaves System Idle and System alone", () => {
    const ask = vi.fn(() => "C:/a.exe");
    nextPrograms([process(0, 0), process(4, 0)], new Map(), ask);
    expect(ask).not.toHaveBeenCalled();
  });

  it("opens each process once over many looks of the real probe", () => {
    const { fake } = windows();
    const probe = windowsProgramProbe(() => [process(10), process(11)], () => fake);
    for (let look = 0; look < 10; look += 1) probe();
    expect(fake.openProcess).toHaveBeenCalledTimes(2);
  });

  it("keeps the last programs when the list fails once, and fails on a first look that can't list", () => {
    const { fake } = windows();
    let broken = false;
    const probe = windowsProgramProbe(() => {
      if (broken) throw new Error("the process list kept growing");
      return [process(10)];
    }, () => fake);
    expect(probe().programs.size).toBe(1);
    broken = true;
    expect(probe().programs.size).toBe(1);
    expect(fake.openProcess).toHaveBeenCalledTimes(1);
    const never = windowsProgramProbe(() => {
      throw new Error("no ntdll");
    }, () => fake);
    expect(() => never()).toThrow("no ntdll");
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.test(-helper)?\.|\.fixture\./.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("the main process source", () => {
  const files = sources(import.meta.dirname).map((file) => ({ name: path.basename(file), text: readFileSync(file, "utf8") }));

  it("asks Windows to open a process in one place, with the limited right", () => {
    const using = files.filter((file) => /OpenProcess/i.test(file.text));
    expect(using.map((file) => file.name)).toEqual(["program-list.ts"]);
    const text = using[0]!.text;
    expect(text.match(/OpenProcess/g)).toHaveLength(1);
    expect(text).toMatch(/const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;/);
    // The only call passes that constant, not a number or another name.
    expect([...text.matchAll(/\.openProcess\(([^,)]*),/g)].map((match) => match[1])).toEqual(["PROCESS_QUERY_LIMITED_INFORMATION"]);
  });

  it("has no way to write to, inject into or debug another process", () => {
    const banned = /WriteProcessMemory|ReadProcessMemory|CreateRemoteThread|NtCreateThreadEx|VirtualAllocEx|VirtualProtectEx|QueueUserAPC|SetWindowsHookEx|DebugActiveProcess|SetThreadContext|NtWriteVirtualMemory|PROCESS_ALL_ACCESS|PROCESS_VM_(WRITE|OPERATION|READ)|PROCESS_CREATE_THREAD|PROCESS_DUP_HANDLE/;
    expect(files.filter((file) => banned.test(file.text)).map((file) => file.name)).toEqual([]);
  });

  it("scans something", () => {
    expect(files.length).toBeGreaterThan(100);
  });
});
