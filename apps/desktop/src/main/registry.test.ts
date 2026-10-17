import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeModules, discoverModules, type ModuleProblem } from "./registry";

async function makeModule(root: string, folder: string, id: string, name = id, permissions: Record<string, unknown> = { network: [] }): Promise<string> {
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
      permissions,
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
    expect(modules.get("tavora.notes")?.owner).toBe("official");
    expect(modules.get("local.me.tracker")?.owner).toBe("local");
  });

  it("lets only Tavora's own modules ask for WebAssembly", async () => {
    const official = await mkdtemp(path.join(tmpdir(), "tavora-official-"));
    const local = await mkdtemp(path.join(tmpdir(), "tavora-local-"));
    await makeModule(official, "board", "tavora.board", "Board", { network: [], webAssembly: true });
    await makeModule(local, "greedy", "community.example.greedy", "Greedy", { network: [], webAssembly: true });
    await makeModule(local, "plain", "community.example.plain");
    const problems: ModuleProblem[] = [];
    const modules = await discoverModules({ official: [official], local: [local] }, problems);
    expect([...modules.keys()].sort()).toEqual(["community.example.plain", "tavora.board"]);
    expect(modules.get("tavora.board")?.manifest.permissions.webAssembly).toBe(true);
    expect(problems).toEqual([{ folder: "greedy", message: "permissions.webAssembly is only for Tavora's own modules" }]);
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

  it("reports why a local folder was not loaded, but not an official one or a plain folder", async () => {
    const official = await mkdtemp(path.join(tmpdir(), "tavora-official-"));
    const local = await mkdtemp(path.join(tmpdir(), "tavora-local-"));
    await makeModule(official, "good", "tavora.good");
    await mkdir(path.join(official, "notamodule"));
    await mkdir(path.join(local, "notamodule"));
    await mkdir(path.join(local, "broken"));
    await writeFile(path.join(local, "broken", "tavora.module.json"), "{ nope");
    await mkdir(path.join(local, "invalid"));
    await writeFile(path.join(local, "invalid", "tavora.module.json"), JSON.stringify({ id: "x" }));
    const unbuilt = await makeModule(local, "unbuilt", "local.me.unbuilt");
    await rm(path.join(unbuilt, "index.html"));
    await makeModule(local, "fake", "tavora.fake");
    const problems: ModuleProblem[] = [];
    await discoverModules({ official: [official], local: [local] }, problems);
    expect(problems.map((problem) => problem.folder).sort()).toEqual(["broken", "fake", "invalid", "unbuilt"]);
    expect(problems.find((problem) => problem.folder === "unbuilt")?.message).toContain("index.html");
    expect(problems.find((problem) => problem.folder === "fake")?.message).toContain("reserved");
  });
});

describe("minTavora", () => {
  it("does not load a module that needs a newer Tavora, and says why", async () => {
    const local = await mkdtemp(path.join(tmpdir(), "tavora-local-"));
    const later = await makeModule(local, "later", "example.later");
    const manifest = JSON.parse(await readFile(path.join(later, "tavora.module.json"), "utf8"));
    await writeFile(path.join(later, "tavora.module.json"), JSON.stringify({ ...manifest, minTavora: "0.18.0" }));
    await makeModule(local, "now", "example.now");
    const problems: ModuleProblem[] = [];
    const modules = await discoverModules({ local: [local], tavoraVersion: "0.17.9" }, problems);
    expect([...modules.keys()]).toEqual(["example.now"]);
    expect(problems).toEqual([{ folder: "later", message: "it needs Tavora 0.18.0 or newer (this is 0.17.9)" }]);
    expect([...(await discoverModules({ local: [local], tavoraVersion: "0.18.0" })).keys()].sort()).toEqual(["example.later", "example.now"]);
  });
});

describe("panel types", () => {
  it("needs every panel type's page and icon, and gives each type its icon", async () => {
    const local = await mkdtemp(path.join(tmpdir(), "tavora-local-"));
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const write = async (folder: string, panels: unknown[]) => {
      const dir = await makeModule(local, folder, `example.${folder}`);
      const manifest = JSON.parse(await readFile(path.join(dir, "tavora.module.json"), "utf8"));
      await writeFile(path.join(dir, "tavora.module.json"), JSON.stringify({ ...manifest, panels }));
      return dir;
    };
    const typed = await write("typed", [{ id: "a", name: "A" }, { id: "b", name: "B", entry: "b.html", icon: "b.png" }]);
    await writeFile(path.join(typed, "b.html"), "<!doctype html>");
    await writeFile(path.join(typed, "b.png"), png);
    await write("pageless", [{ id: "b", name: "B", entry: "b.html" }]);
    const problems: ModuleProblem[] = [];
    const modules = await discoverModules({ local: [local] }, problems);
    expect([...modules.keys()]).toEqual(["example.typed"]);
    expect(problems).toEqual([{ folder: "pageless", message: "the entry file b.html is missing (is it built?)" }]);
    const info = await describeModules(local, modules);
    expect(info.get("example.typed")!.panelIcons).toEqual({ a: null, b: `data:image/png;base64,${png.toString("base64")}` });
  });
});

describe("describeModules", () => {
  it("lets Settings remove only direct children of the player's own modules folder", async () => {
    const official = await mkdtemp(path.join(tmpdir(), "tavora-official-"));
    const dev = await mkdtemp(path.join(tmpdir(), "tavora-dev-"));
    const own = await mkdtemp(path.join(tmpdir(), "tavora-own-"));
    await makeModule(official, "notes", "tavora.notes");
    await makeModule(dev, "tool", "local.dev.tool");
    await makeModule(own, "mine", "local.me.mine");
    await makeModule(own, "nested/deeper", "local.me.deeper");
    const modules = await discoverModules({ official: [official], local: [dev, own] });
    const info = await describeModules(own, modules);
    expect(info.get("tavora.notes")).toEqual({ origin: { kind: "official", folder: "notes" }, removable: false, icon: null, panelIcons: {} });
    expect(info.get("local.dev.tool")).toEqual({ origin: { kind: "dev", folder: "tool" }, removable: false, icon: null, panelIcons: {} });
    expect(info.get("local.me.mine")).toEqual({ origin: { kind: "own", folder: "mine" }, removable: true, icon: null, panelIcons: {} });
    // Found two levels down: not a direct child, so Settings leaves it alone.
    expect(info.has("local.me.deeper")).toBe(false);
  });

  it("passes on a module's own icon as a data address", async () => {
    const own = await mkdtemp(path.join(tmpdir(), "tavora-own-"));
    const dir = await makeModule(own, "pictured", "local.me.pictured");
    const manifest = JSON.parse(await readFile(path.join(dir, "tavora.module.json"), "utf8"));
    await writeFile(path.join(dir, "tavora.module.json"), JSON.stringify({ ...manifest, icon: "icon.png" }));
    await writeFile(path.join(dir, "icon.png"), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]));
    const modules = await discoverModules({ local: [own] });
    const info = await describeModules(own, modules);
    expect(info.get("local.me.pictured")?.icon).toMatch(/^data:image\/png;base64,/);
  });

  it("does not offer the folder itself when the module sits straight in it", async () => {
    const own = await mkdtemp(path.join(tmpdir(), "tavora-own-"));
    await makeModule(path.dirname(own), path.basename(own), "local.me.straight");
    const modules = await discoverModules({ local: [own] });
    const info = await describeModules(own, modules);
    expect(info.get("local.me.straight")?.removable).toBe(false);
  });
});
