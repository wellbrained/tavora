import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { catchMainErrors, crashLine, CRASHES_KEPT, recordCrash, recordMainError, useCrashLog } from "./crash-log";

const folders: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("crash log", () => {
  it("writes one short line per process gone, keeps the newest and leaves clean exits out", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const data = mkdtempSync(path.join(os.tmpdir(), "tavora-crashes-"));
    folders.push(data);
    useCrashLog(data);
    recordCrash({ type: "GPU", reason: "crashed", exitCode: -1073741819 }, new Date("2026-11-17T10:00:00Z"));
    recordCrash({ type: "module page", reason: "oom", exitCode: 0, moduleId: "local.satisfactory" }, new Date("2026-11-17T10:01:00Z"));
    recordCrash({ type: "Utility", reason: "clean-exit", exitCode: 0 });
    const lines = readFileSync(path.join(data, "logs", "crashes.log"), "utf8").trim().split("\n");
    expect(lines).toEqual([
      "2026-11-17T10:00:00.000Z GPU gone: crashed, exit -1073741819",
      "2026-11-17T10:01:00.000Z module page gone: oom, exit 0, module local.satisfactory",
    ]);
    for (let n = 0; n < CRASHES_KEPT + 5; n++) recordCrash({ type: "GPU", reason: "crashed", exitCode: n });
    expect(readFileSync(path.join(data, "logs", "crashes.log"), "utf8").trim().split("\n")).toHaveLength(CRASHES_KEPT);
  });

  it("keeps only plain words from what Electron reports", () => {
    expect(crashLine({ type: "GPU\n<x>", reason: "", exitCode: 1 })).toBe("GPUx gone: ?, exit 1");
  });

  it("logs an error nothing caught in the main process, its stack in the error log and a plain line here", () => {
    const errors: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args));
    const data = mkdtempSync(path.join(os.tmpdir(), "tavora-crashes-"));
    folders.push(data);
    useCrashLog(data);
    const target = new EventEmitter();
    catchMainErrors(target as unknown as NodeJS.Process);
    const thrown = new Error(`Object has been destroyed at ${path.join(os.homedir(), "secret")}`);
    target.emit("uncaughtException", thrown);
    target.emit("unhandledRejection", "no answer");
    expect(errors).toEqual([
      ["[tavora] uncaught error in the main process:", thrown],
      ["[tavora] unhandled rejection in the main process:", "no answer"],
    ]);
    const lines = readFileSync(path.join(data, "logs", "crashes.log"), "utf8").trim().split("\n");
    expect(lines.map((line) => line.replace(/^\S+ /, ""))).toEqual(["main process uncaught error", "main process unhandled rejection"]);
  });

  it("drops an error made while reporting one, so a broken console can't loop", () => {
    let calls = 0;
    vi.spyOn(console, "error").mockImplementation(() => {
      calls++;
      recordMainError("uncaught error", new Error("again"));
      throw new Error("EPIPE");
    });
    expect(() => recordMainError("uncaught error", new Error("first"))).not.toThrow();
    expect(calls).toBe(1);
  });
});
