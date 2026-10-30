import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "@tavora/module-schema";
import { SDK_VERSION } from "@tavora/sdk";
import { describe, expect, it } from "vitest";
import { BASE_COMPILER_OPTIONS, copyExample, PACK_RANGE, SDK_RANGE, slugOf } from "./example-copy";
import { isExampleModule } from "./registry";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const examples = path.join(repo, "examples");
const readJson = async (file: string) => JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;

async function files(dir: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await files(path.join(dir, entry.name), relative)));
    else found.push(relative);
  }
  return found.sort();
}

describe("copyExample", () => {
  const shipped = ["vanilla-module", "react-module", "vue-module", "panels-module"];

  it("knows every example module in the repository", async () => {
    for (const folder of shipped) expect(isExampleModule(((await readJson(path.join(examples, folder, "tavora.module.json"))).id as string))).toBe(true);
    expect(isExampleModule("tavora.playground")).toBe(false);
  });

  it.each(shipped)("makes %s a project of its own that builds outside the repository", async (folder) => {
    const target = path.join(await mkdtemp(path.join(tmpdir(), "tavora-copy-")), "my-module");
    await copyExample(path.join(examples, folder), target, { id: "dev.my-module", name: "My Module" });

    const manifest = await readJson(path.join(target, "tavora.module.json"));
    expect(validateManifest(manifest).ok).toBe(true);
    expect(manifest).toMatchObject({ id: "dev.my-module", name: "My Module", version: "0.1.0", $schema: "https://docs.mytavora.app/schema/tavora.module.schema.json" });
    expect(Object.keys(manifest)[0]).toBe("$schema");

    const pkg = await readJson(path.join(target, "package.json"));
    expect(pkg).toMatchObject({ name: "my-module", version: "0.1.0", dependencies: { "@tavora/sdk": SDK_RANGE }, devDependencies: { "@tavora/pack": PACK_RANGE }, scripts: { dev: "vite build --watch" } });
    expect(JSON.stringify(pkg)).not.toContain("workspace:");
    expect((pkg.devDependencies as Record<string, string>).typescript).toBeDefined();
    // The build config comes from @tavora/pack and imports nothing from Node itself.
    expect((pkg.devDependencies as Record<string, string>)["@types/node"]).toBeUndefined();

    const tsconfig = await readJson(path.join(target, "tsconfig.json"));
    expect(tsconfig.extends).toBeUndefined();
    expect(tsconfig.compilerOptions).toMatchObject(BASE_COMPILER_OPTIONS);

    // The sources come along; installs, builds and hidden files don't.
    const copied = await files(target);
    expect(copied).toContain(".gitignore");
    expect(copied.some((file) => file.startsWith("src/"))).toBe(true);
    expect(copied.some((file) => file.startsWith("node_modules/") || file.startsWith("dist/"))).toBe(false);
  });

  it("leaves out what the example installed and built", async () => {
    const source = await mkdtemp(path.join(tmpdir(), "tavora-example-"));
    await writeFile(path.join(source, "tavora.module.json"), JSON.stringify({ id: "local.example.x", name: "X", version: "0.0.0", apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } }));
    for (const dir of ["node_modules/vite", "dist", ".cache", "src"]) await mkdir(path.join(source, dir), { recursive: true });
    for (const file of ["node_modules/vite/index.js", "dist/index.html", ".cache/x", "src/main.ts", "tsconfig.tsbuildinfo"]) await writeFile(path.join(source, file), "x");
    const target = path.join(source, "..", `${path.basename(source)}-copy`);
    await copyExample(source, target, { id: "local.x", name: "X" });
    expect(await files(target)).toEqual([".gitignore", "src/main.ts", "tavora.module.json"]);
  });

  it("copies nothing into a folder that is already there", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "tavora-copy-"));
    await writeFile(path.join(target, "mine.txt"), "keep");
    await expect(copyExample(path.join(examples, "vanilla-module"), target, { id: "local.my-module", name: "My Module" })).rejects.toMatchObject({ key: "error.copyExists" });
    expect(await files(target)).toEqual(["mine.txt"]);
  });

  it("leaves nothing behind when the example needs another package of the repository", async () => {
    const source = await mkdtemp(path.join(tmpdir(), "tavora-example-"));
    await writeFile(path.join(source, "tavora.module.json"), JSON.stringify({ id: "local.example.x", name: "X", version: "0.0.0", apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } }));
    await writeFile(path.join(source, "package.json"), JSON.stringify({ name: "x", dependencies: { "@tavora/official-ui": "workspace:*" } }));
    const target = path.join(source, "..", `${path.basename(source)}-copy`);
    await expect(copyExample(source, target, { id: "local.x", name: "X" })).rejects.toMatchObject({ key: "error.copyWorkspace" });
    expect(existsSync(target)).toBe(false);
  });

  it("depends on the SDK and pack that ship with this Tavora", async () => {
    expect(SDK_RANGE).toBe(`^${SDK_VERSION}`);
    expect(PACK_RANGE).toBe(`^${(await readJson(path.join(repo, "packages/pack/package.json"))).version}`);
  });

  it("has the repository's TypeScript settings, without what only the repository uses", async () => {
    const { declaration: _declaration, sourceMap: _sourceMap, customConditions: _conditions, ...base } = (await readJson(path.join(repo, "tsconfig.base.json"))).compilerOptions as Record<string, unknown>;
    expect(BASE_COMPILER_OPTIONS).toEqual(base);
  });
});

describe("slugOf", () => {
  it("makes a folder and package name from a module name", () => {
    expect(slugOf("My Vue Module")).toBe("my-vue-module");
    expect(slugOf("  Über Tracker 2! ")).toBe("uber-tracker-2");
    expect(slugOf("3D Map")).toBe("3d-map");
    expect(slugOf("日本")).toBe("my-module");
  });
});
