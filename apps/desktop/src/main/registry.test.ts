import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverModules } from "./registry";

async function makeModule(root: string, folder: string, id: string, name = id): Promise<string> {
  const dir = path.join(root, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "tavora.module.json"),
    JSON.stringify({
      id,
      name,
      version: "1.0.0",
      apiVersion: "1",
      entry: "index.html",
      games: [],
      viewport: { minWidth: 100, minHeight: 100 },
      permissions: { network: [] },
    }),
  );
  await writeFile(path.join(dir, "index.html"), "<!doctype html>");
  return dir;
}

describe("discoverModules", () => {
  it("marks modules by where they were found, never by what they claim", async () => {
    const official = await mkdtemp(path.join(tmpdir(), "tavora-official-"));
    const local = await mkdtemp(path.join(tmpdir(), "tavora-local-"));
    await makeModule(official, "notes", "tavora.notes");
    await makeModule(local, "mine", "local.me.tracker");
    const modules = await discoverModules({ official: [official], local: [local] });
    expect(modules.get("tavora.notes")?.provenance).toBe("official");
    expect(modules.get("local.me.tracker")?.provenance).toBe("local");
  });

  it("refuses the tavora publisher outside the official folder", async () => {
    const local = await mkdtemp(path.join(tmpdir(), "tavora-local-"));
    await makeModule(local, "fake", "tavora.notes");
    await makeModule(local, "fine", "tavoramods.notes");
    const modules = await discoverModules({ local: [local] });
    expect([...modules.keys()]).toEqual(["tavoramods.notes"]);
  });

  it("keeps the official module when a local one has the same id", async () => {
    const official = await mkdtemp(path.join(tmpdir(), "tavora-official-"));
    const local = await mkdtemp(path.join(tmpdir(), "tavora-local-"));
    await makeModule(official, "a", "community.x.tool", "Official copy");
    await makeModule(local, "b", "community.x.tool", "Local copy");
    const modules = await discoverModules({ official: [official], local: [local] });
    expect(modules.get("community.x.tool")?.manifest.name).toBe("Official copy");
  });

  it("skips a folder without a manifest, such as the shared official UI package", async () => {
    const official = await mkdtemp(path.join(tmpdir(), "tavora-official-"));
    await mkdir(path.join(official, "shared"));
    await makeModule(official, "todos", "tavora.todos");
    const modules = await discoverModules({ official: [official] });
    expect([...modules.keys()]).toEqual(["tavora.todos"]);
  });
});
