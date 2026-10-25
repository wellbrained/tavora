import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useRunTempDir } from "./test-temp.ts";

const NAMES = ["TEMP", "TMP", "TMPDIR"] as const;

describe("useRunTempDir", () => {
  let saved: Record<string, string | undefined>;
  let root: string;

  beforeEach(() => {
    saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
    root = mkdtempSync(path.join(tmpdir(), "test-temp-"));
    for (const name of NAMES) process.env[name] = root;
  });

  afterEach(() => {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("points the temp variables at a folder of the run and removes it at the end", () => {
    const cleanup = useRunTempDir();
    const dir = process.env.TEMP!;
    expect(path.dirname(dir)).toBe(path.join(root, "tavora-test-runs"));
    expect(process.env.TMP).toBe(dir);
    expect(process.env.TMPDIR).toBe(dir);
    expect(existsSync(dir)).toBe(true);
    cleanup();
    expect(existsSync(dir)).toBe(false);
  });

  it("removes the folders of runs whose process is gone and keeps those still running", () => {
    const runs = path.join(root, "tavora-test-runs");
    const gone = path.join(runs, "2147483646-old");
    const running = path.join(runs, `${process.pid}-other`);
    mkdirSync(path.join(gone, "tavora-catalog-x"), { recursive: true });
    mkdirSync(running, { recursive: true });
    useRunTempDir()();
    expect(existsSync(gone)).toBe(false);
    expect(existsSync(running)).toBe(true);
  });
});
