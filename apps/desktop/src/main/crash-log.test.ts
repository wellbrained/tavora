import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crashLine, CRASHES_KEPT, recordCrash, useCrashLog } from "./crash-log";

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
});
