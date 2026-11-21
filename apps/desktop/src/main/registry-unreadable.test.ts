// A modules folder that is there but can't be read right now must not count as "no modules": panels would be forgotten.
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { developmentProjects, discoverModules, panelsWait, type ModuleProblem } from "./registry";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, readdir: vi.fn(real.readdir) };
});

let dir: string;
let busy: string[] = [];
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-registry-"));
  busy = [];
  const real = vi.mocked(readdir).getMockImplementation()!;
  vi.mocked(readdir).mockImplementation(((target: string, options: never) =>
    busy.includes(String(target)) ? Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" })) : real(target, options)) as never);
});
afterEach(async () => {
  busy = [];
  await rm(dir, { recursive: true, force: true });
});

describe("a modules folder that can't be read", () => {
  it("keeps every panel waiting", async () => {
    const modules = path.join(dir, "modules");
    await mkdir(modules);
    busy = [modules];
    const problems: ModuleProblem[] = [];
    expect((await discoverModules({ local: [modules] }, problems)).size).toBe(0);
    expect(panelsWait(problems)("some.module")).toBe(true);
  });

  it("counts a development folder that can't be read as unsure too", async () => {
    const folder = path.join(dir, "dev");
    await mkdir(folder);
    busy = [folder];
    expect(await developmentProjects(folder)).toBe("missing");
    const problems: ModuleProblem[] = [];
    await discoverModules({ development: [folder] }, problems);
    expect(panelsWait(problems)("some.module")).toBe(true);
  });

  it("keeps panels waiting for a project inside it that can't be read", async () => {
    const folder = path.join(dir, "dev");
    const project = path.join(folder, "dice");
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "notes.txt"), "not a manifest yet");
    busy = [project];
    expect(await developmentProjects(folder)).toEqual([project]);
  });

  it("says nothing about a folder that simply isn't there", async () => {
    const problems: ModuleProblem[] = [];
    await discoverModules({ local: [path.join(dir, "no-such-folder")] }, problems);
    expect(problems).toEqual([]);
    expect(panelsWait(problems)("some.module")).toBe(false);
  });
});
