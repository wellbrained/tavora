import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findCli } from "./ai-usage-cli";

describe("findCli", () => {
  it("finds the first command on PATH without blocking", async () => {
    const one = await mkdtemp(path.join(tmpdir(), "tavora-cli-"));
    const two = await mkdtemp(path.join(tmpdir(), "tavora-cli-"));
    await mkdir(two, { recursive: true });
    await writeFile(path.join(two, "claude"), "");
    const found = await findCli({ win32: ["claude.exe"], other: ["claude"] }, { PATH: [one, two].join(path.delimiter) }, "linux");
    expect(found).toBe(path.join(two, "claude"));
  });

  it("answers null when it is nowhere", async () => {
    const one = await mkdtemp(path.join(tmpdir(), "tavora-cli-"));
    expect(await findCli({ win32: ["x.exe"], other: ["tavora-no-such-cli"] }, { PATH: one }, "linux")).toBeNull();
  });
});
