import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const asked: string[] = [];
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    // A folder named "dead" never answers, as a network drive that is gone.
    access: ((file: string, ...rest: unknown[]) => {
      asked.push(String(file));
      if (String(file).includes("dead-drive")) return new Promise(() => undefined);
      return (actual.access as (...args: unknown[]) => Promise<void>)(file, ...rest);
    }) as typeof actual.access,
  };
});

import { findCli, forgetFoundClis } from "./ai-usage-cli";

beforeEach(() => {
  forgetFoundClis();
  asked.length = 0;
});

describe("findCli", () => {
  it("finds the first command on PATH without blocking", async () => {
    const one = await mkdtemp(path.join(tmpdir(), "tavora-cli-"));
    const two = await mkdtemp(path.join(tmpdir(), "tavora-cli-"));
    await mkdir(two, { recursive: true });
    await writeFile(path.join(two, "claude"), "");
    const names = { win32: ["claude.exe"], other: ["claude"] };
    const env = { PATH: [one, two].join(path.delimiter) };
    expect(await findCli(names, env, "linux")).toBe(path.join(two, "claude"));
    // Kept for this PATH: nothing is looked at again.
    const before = asked.length;
    expect(await findCli(names, env, "linux")).toBe(path.join(two, "claude"));
    expect(asked.length).toBe(before);
  });

  it("answers null when it is nowhere, and believes it for a while", async () => {
    const one = await mkdtemp(path.join(tmpdir(), "tavora-cli-"));
    const names = { win32: ["x.exe"], other: ["tavora-no-such-cli"] };
    expect(await findCli(names, { PATH: one }, "linux")).toBeNull();
    const before = asked.length;
    expect(await findCli(names, { PATH: one }, "linux")).toBeNull();
    expect(asked.length).toBe(before);
  });

  it("skips a folder that did not answer in time, from then on", async () => {
    const good = await mkdtemp(path.join(tmpdir(), "tavora-cli-"));
    await writeFile(path.join(good, "claude"), "");
    const dead = path.join(tmpdir(), "dead-drive");
    const names = { win32: ["claude.exe"], other: ["claude", "claude2"] };
    // Not kept for the second call: another PATH value with the same dead folder first.
    expect(await findCli(names, { PATH: [dead, good].join(path.delimiter) }, "linux", 20)).toBe(path.join(good, "claude"));
    const deadAsks = () => asked.filter((file) => file.includes("dead-drive")).length;
    expect(deadAsks()).toBe(1);
    expect(await findCli(names, { PATH: [dead, good, tmpdir()].join(path.delimiter) }, "linux", 20)).toBe(path.join(good, "claude"));
    expect(deadAsks()).toBe(1);
  });
});
