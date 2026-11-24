import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogPublicKey, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it, vi } from "vitest";

const held = { on: false };
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const readdir = ((target: string, ...rest: unknown[]) => {
    if (held.on && String(target).endsWith("wellbrained.tracker")) return Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" }));
    return (actual.readdir as (...args: unknown[]) => Promise<unknown>)(target, ...rest);
  }) as typeof actual.readdir;
  return { ...actual, readdir };
});

import { installZip } from "./installer";
import { loadInstalledModules } from "./installed-modules";
import { SafetyLists } from "./safety-lists";

const TAVORA = "0.18.0";
const manifest = JSON.stringify({ id: "wellbrained.tracker", name: "Tracker", version: "1.0.0", apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } });

describe("a module folder that stays held while it is checked", () => {
  it("waits for the next start with an unreadable problem, not as changed", async () => {
    const userData = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-held-")));
    const userModules = path.join(userData, "modules");
    await mkdir(userModules);
    const key = generateKeyPairSync("ed25519").privateKey;
    const files: ZipFile[] = [
      { name: "tavora.module.json", data: Buffer.from(manifest) },
      { name: "dist/index.html", data: Buffer.from("<p>hi</p>") },
    ];
    const file = path.join(userData, "p.zip");
    await writeFile(file, writeZip([...files, signFiles(files, key)]));
    await installZip(file, { userData, userModules, tavoraVersion: TAVORA, modules: new Map() });

    const safety = new SafetyLists({ file: path.join(userData, "catalog-lists.json"), baseUrl: "https://api.example.test/", publicKey: catalogPublicKey(generateKeyPairSync("ed25519").privateKey), online: () => false });
    held.on = true;
    const loaded = await loadInstalledModules({ userData, userModules, sources: { local: [userModules] }, tavoraVersion: TAVORA, safety });
    held.on = false;

    expect(loaded.modules.has("wellbrained.tracker")).toBe(false);
    expect(loaded.blocked.get("wellbrained.tracker")?.changed).toBeUndefined();
    expect(loaded.problems).toEqual([expect.objectContaining({ kind: "unreadable", about: expect.objectContaining({ id: "wellbrained.tracker" }) })]);

    const again = await loadInstalledModules({ userData, userModules, sources: { local: [userModules] }, tavoraVersion: TAVORA, safety });
    expect(again.modules.has("wellbrained.tracker")).toBe(true);
    expect(again.problems).toEqual([]);
  });
});
