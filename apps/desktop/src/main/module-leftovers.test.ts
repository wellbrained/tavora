import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ModuleLeftovers } from "./module-leftovers";
import type { InstalledModule } from "./registry";

const KEY = "0123456789abcdef0123456789abcdef";

function module(owner: string, id: string): InstalledModule {
  return { owner, manifest: { id, version: "1.0.0" } } as unknown as InstalledModule;
}

async function setup(installed: InstalledModule[]) {
  const calls: string[] = [];
  const userData = await mkdtemp(path.join(tmpdir(), "tavora-leftovers-"));
  const modules = new Map(installed.map((item) => [item.manifest.id, item]));
  const leftovers = new ModuleLeftovers({
    userData,
    filesRoot: () => path.join(userData, "files"),
    installed: { get: (moduleId) => modules.get(moduleId) },
    forget: (owner, moduleId) => void calls.push(`forget ${owner}/${moduleId}`),
    clearSession: async (partition) => void calls.push(`clear ${partition}`),
    restart: () => void calls.push("restart"),
  });
  /** Saved settings of a module in a workspace, or a browser session of it. */
  const saved = (owner: string, moduleId: string) => mkdir(path.join(userData, "module-data", owner, moduleId, "valheim"), { recursive: true });
  const session = (owner: string, moduleId: string) => mkdir(path.join(userData, "Partitions", `module%3A${owner}%3A${moduleId}@valheim`), { recursive: true });
  return { leftovers, calls, userData, saved, session };
}

describe("ModuleLeftovers", () => {
  it("lists the data of modules that aren't installed, or are installed from another publisher, with who published it", async () => {
    const { leftovers, saved } = await setup([module("official", "tavora.notes"), module(KEY, "acme.map")]);
    await saved("official", "tavora.notes");
    await saved("local", "acme.map");
    await saved(KEY, "acme.gone");
    await leftovers.refresh();
    expect(leftovers.view()).toHaveLength(2);
    expect(leftovers.view()).toEqual(
      expect.arrayContaining([
        { owner: "local", moduleId: "acme.map", publisher: null },
        { owner: KEY, moduleId: "acme.gone", publisher: KEY },
      ]),
    );
  });

  it("deletes a module's leftover data with its browser sessions, and refuses the data of the module installed now", async () => {
    const { leftovers, calls, userData, saved, session } = await setup([module("official", "tavora.notes")]);
    await saved(KEY, "acme.gone");
    await session(KEY, "acme.gone");
    await leftovers.refresh();

    await leftovers.delete(KEY, "acme.gone");
    expect(calls).toEqual([`forget ${KEY}/acme.gone`, `clear persist:module:${KEY}:acme.gone@valheim`]);
    expect(existsSync(path.join(userData, "module-data", KEY, "acme.gone"))).toBe(false);
    // Looked at again: nothing is left to list.
    expect(leftovers.view()).toEqual([]);

    await expect(leftovers.delete("official", "tavora.notes")).rejects.toMatchObject({ key: "error.dataInUse" });
  });

  it("offers a signed module the data of its unsigned local copy, and queues the move before restarting", async () => {
    const { leftovers, calls, userData, saved } = await setup([module(KEY, "acme.map"), module("local", "acme.other")]);
    await saved("local", "acme.map");
    await saved("local", "acme.other");
    await leftovers.refresh();
    expect(leftovers.localWaiting(module(KEY, "acme.map"))).toBe(true);
    // An unsigned module has no signed version to hand its data to.
    expect(leftovers.localWaiting(module("local", "acme.other"))).toBe(false);

    await leftovers.moveLocal("acme.map");
    expect(calls).toEqual(["restart"]);
    expect(JSON.parse(await readFile(path.join(userData, "module-data-pending.json"), "utf8")).moves).toEqual([{ moduleId: "acme.map", to: KEY }]);
    await expect(leftovers.moveLocal("acme.other")).rejects.toMatchObject({ key: "error.noLocalData" });
    await expect(leftovers.moveLocal("acme.missing")).rejects.toMatchObject({ key: "error.noLocalData" });
  });
});
