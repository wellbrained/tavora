import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moduleConfig, noticeSource } from "./vite.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "tavora-config-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const install = (name: string, files: Record<string, string>, base = root) => {
  const dir = path.join(base, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name }));
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
};

describe("moduleConfig", () => {
  it("builds src/ to dist/ for Tavora's browser, from the module's folder", () => {
    const config = moduleConfig({ root });
    expect(config).toMatchObject({ root: path.join(root, "src"), base: "./" });
    expect(config.build).toMatchObject({ outDir: path.join(root, "dist"), emptyOutDir: true, target: "chrome130", modulePreload: { polyfill: false } });
    expect(config.resolve?.conditions).toContain("source");
    expect(config.resolve?.dedupe).toEqual(["vue", "@tavora/sdk"]);
    expect(config.build?.rollupOptions?.input).toEqual({ index: path.join(root, "src", "index.html") });
  });

  it("takes every page as an input and passes the options on", () => {
    const config = moduleConfig({ root, pages: ["index", "overlay"], publicDir: "public", dedupe: ["react", "vue"], chunkSizeWarningLimit: 1500, alias: { a: "b" }, define: { x: "1" } });
    expect(config.build?.rollupOptions?.input).toEqual({ index: path.join(root, "src", "index.html"), overlay: path.join(root, "src", "overlay.html") });
    expect(config.publicDir).toBe(path.join(root, "public"));
    expect(config.resolve).toMatchObject({ dedupe: ["vue", "@tavora/sdk", "react"], alias: { a: "b" } });
    expect(config.build?.chunkSizeWarningLimit).toBe(1500);
    expect(config.define).toEqual({ x: "1" });
  });
});

describe("notices", () => {
  it("copies the licences after the build, from the module's folder and from the kit's", () => {
    writeFileSync(path.join(root, "LICENSE"), "mine");
    install("vue", { LICENSE: "vue licence" });
    install("@tavora/official-ui", {});
    // The kit's own dependencies sit next to it, not in the module's node_modules.
    const kit = path.join(root, "node_modules", "@tavora", "official-ui");
    install("reka-ui", { "LICENSE.md": "reka licence" }, kit);
    const plugin = moduleConfig({ root, notices: { MODULE: "./LICENSE", VUE: "vue", "REKA-UI": "reka-ui" } }).plugins!.at(-1) as { closeBundle(): void };
    plugin.closeBundle();
    expect(readFileSync(path.join(root, "dist", "MODULE-LICENSE.txt"), "utf8")).toBe("mine");
    expect(readFileSync(path.join(root, "dist", "VUE-LICENSE.txt"), "utf8")).toBe("vue licence");
    expect(readFileSync(path.join(root, "dist", "REKA-UI-LICENSE.txt"), "utf8")).toBe("reka licence");
  });

  it("stops when a licence cannot be found", () => {
    install("empty", {});
    expect(() => noticeSource(root, "missing")).toThrow(/No licence file found for missing/);
    expect(() => noticeSource(root, "empty")).toThrow(/No licence file found for empty/);
    expect(() => noticeSource(root, "./LICENSE")).toThrow(/not found/);
  });
});
