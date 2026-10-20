import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateManifest } from "@tavora/module-schema";
import { MIN_TAVORA, SDK_VERSION } from "@tavora/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModule, CreateError, defaultsFor, idProblem, slugOf, TEMPLATES } from "./create.ts";
import { CATALOG } from "../../../apps/desktop/src/main/catalog.ts";
import { GAMES } from "./games.ts";
import { VERSIONS } from "./versions.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "tavora-create-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const json = async (file: string) => JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;

describe("createModule", () => {
  it.each(TEMPLATES)("makes a %s project with a valid manifest and every placeholder filled", async (template) => {
    const dir = path.join(root, "My Cool Module");
    const files = await createModule({ dir, id: "example.cool-module", name: "Cool \"Module\" <1>", template, packageManager: "pnpm" });
    expect(files).toEqual(expect.arrayContaining([".gitignore", "README.md", "package.json", "tavora.module.json", "tsconfig.json", "vite.config.ts", "src/index.html", "src/style.css"]));

    const manifest = validateManifest(await json(path.join(dir, "tavora.module.json")));
    expect(manifest.ok).toBe(true);
    expect(manifest.ok && manifest.manifest).toMatchObject({ id: "example.cool-module", name: "Cool \"Module\" <1>", minTavora: MIN_TAVORA, version: "0.1.0" });

    const pkg = await json(path.join(dir, "package.json"));
    expect(pkg.name).toBe("my-cool-module");
    expect((pkg.dependencies as Record<string, string>)["@tavora/sdk"]).toBe(`^${SDK_VERSION}`);
    expect(pkg.scripts).toMatchObject({ dev: "vite build --watch", build: "vite build", zip: "tavora-pack ." });

    expect(await readFile(path.join(dir, "src/index.html"), "utf8")).toContain("<title>Cool &quot;Module&quot; &lt;1&gt;</title>");
    const readme = await readFile(path.join(dir, "README.md"), "utf8");
    expect(readme).toContain("pnpm dev");
    expect(readme).toContain("pnpm exec tavora-pack . --key");
    for (const file of files) {
      const text = await readFile(path.join(dir, file), "utf8");
      // Vue templates use {{ name }} with spaces; ours never have them.
      expect(text, file).not.toMatch(/\{\{\w+\}\}/);
    }
  });

  it("writes npm commands into the README unless another manager ran it", async () => {
    await createModule({ dir: root, id: "example.notes", name: "Notes", template: "vanilla" });
    const readme = await readFile(path.join(root, "README.md"), "utf8");
    expect(readme).toContain("npm run dev");
    expect(readme).toContain("npx tavora-pack . --key");
  });

  it("keeps Vue's own template braces", async () => {
    await createModule({ dir: root, id: "example.notes", name: "Notes", template: "vue" });
    expect(await readFile(path.join(root, "src/App.vue"), "utf8")).toContain("{{ status }}");
  });

  it("refuses a folder that has files, a bad id, a tavora. id and an empty name", async () => {
    await writeFile(path.join(root, "keep.txt"), "mine");
    await expect(createModule({ dir: root, id: "example.notes", name: "Notes", template: "vanilla" })).rejects.toThrow(/not empty/);
    expect(await readFile(path.join(root, "keep.txt"), "utf8")).toBe("mine");
    const fresh = path.join(root, "fresh");
    await expect(createModule({ dir: fresh, id: "Notes", name: "Notes", template: "vanilla" })).rejects.toThrow(CreateError);
    await expect(createModule({ dir: fresh, id: "tavora.notes", name: "Notes", template: "vanilla" })).rejects.toThrow(/Tavora's own/);
    await expect(createModule({ dir: fresh, id: "example.notes", name: "  ", template: "vanilla" })).rejects.toThrow(/name/);
    await expect(createModule({ dir: fresh, id: "example.notes", name: "Notes", template: "svelte" as "vue" })).rejects.toThrow(/template/);
  });
});

describe("games", () => {
  it("a module made for one game lists only that game", async () => {
    const dir = path.join(root, "build-planner");
    await createModule({ dir, id: "example.build-planner", name: "Build Planner", template: "vanilla", game: "poe2" });
    const manifest = validateManifest(await json(path.join(dir, "tavora.module.json")));
    expect(manifest.ok && manifest.manifest.games).toEqual(["poe2"]);
    const any = path.join(root, "any");
    await createModule({ dir: any, id: "example.any", name: "Any", template: "vanilla" });
    expect((await json(path.join(any, "tavora.module.json"))).games).toEqual([]);
    await expect(createModule({ dir: path.join(root, "bad"), id: "example.bad", name: "Bad", template: "vanilla", game: "Path of Exile" })).rejects.toThrow(/game id/);
  });

  it("are Tavora's built-in games, and the manifest reference lists every id", async () => {
    expect(GAMES).toEqual(CATALOG.map(({ id, name }) => ({ id, name })));
    const reference = await readFile(path.resolve(import.meta.dirname, "../../../apps/docs/reference/manifest.md"), "utf8");
    for (const game of GAMES) expect(reference, game.id).toContain(`| \`${game.id}\` |`);
  });
});

describe("defaults", () => {
  it("come from the folder name and are valid", () => {
    expect(defaultsFor("projects/Raid Timer")).toEqual({ id: "my.raid-timer", name: "Raid Timer" });
    expect(slugOf("2048 helper")).toBe("module-2048-helper");
    for (const folder of ["x", "Ünïcode!!", "2048", "a".repeat(100)]) expect(idProblem(defaultsFor(folder).id), folder).toBeNull();
  });
});

describe("versions", () => {
  it("are the SDK's, pack's and the SDK's MIN_TAVORA in this repository", async () => {
    const pack = await json(path.resolve(import.meta.dirname, "../../pack/package.json"));
    expect(VERSIONS).toEqual({ sdk: SDK_VERSION, pack: pack.version, minTavora: MIN_TAVORA });
  });
});
