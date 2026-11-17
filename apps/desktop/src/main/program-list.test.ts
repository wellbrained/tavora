import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { programPath, type Windows } from "./program-list";

// Ban safety: Tavora only reads a program's path, with limited rights, and never touches another process.
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

function windows(overrides: Partial<Windows> = {}) {
  const calls: string[] = [];
  const fake: Windows = {
    enumProcesses: vi.fn(() => 0),
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
