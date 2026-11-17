// The Vite settings every Tavora module shares: `import { moduleConfig } from "@tavora/pack/vite"`.
//
// Node-only build tooling (no Vue, no browser code), so a vanilla module can use it as it is. The framework
// plugin (Vue, React, Tailwind) stays in the module's own config and goes in through `plugins`. Nothing here imports
// Vite, so the module's own copy of it is the only one; the result goes into Vite's `defineConfig`.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { noticesFor } from "./notices.ts";

export interface ModuleConfigOptions {
  /** The module's folder, where `src/` is. Default: the folder Vite runs in. */
  root?: string;
  /** The pages in `src/`, without `.html`: the panel, and any overlay or second panel type. Default: `["index"]`. */
  pages?: string[];
  /**
   * Licence files copied into `dist/` as `<NAME>-LICENSE.txt`, for what the bundle contains. The value is a package
   * name (its licence file is found from the module's folder, then from the shared kit's) or a file in the module's
   * folder, written `./LICENSE`. A missing one stops the build.
   */
  notices?: Record<string, string>;
  /** The framework plugins: `vue()`, `react()`, `tailwindcss()`. */
  plugins?: unknown[];
  /** A folder of files copied as they are, such as `public` (in the module's folder). */
  publicDir?: string;
  /** Packages that must end up in the bundle once. Always includes `vue` and `@tavora/sdk`. */
  dedupe?: string[];
  alias?: Record<string, string>;
  define?: Record<string, string>;
  /** The size (kB) from which Vite warns about a chunk; a module loads from disk, so big is fine. Default: Vite's. */
  chunkSizeWarningLimit?: number;
}

/** What Vite resolves package exports with in a browser build (its `defaultClientConditions`), after `source`. */
const CLIENT_CONDITIONS = ["module", "browser", "development|production"];

const LICENCE_FILE = /^licen[cs]e(\.(md|txt))?$/i;

/** The folder of an installed package, looking from each folder upwards; null when none has it. */
function findPackage(name: string, from: string[]): string | null {
  for (const start of from) {
    for (let dir = start; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, "node_modules", name);
      if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
      if (path.dirname(dir) === dir) break;
    }
  }
  return null;
}

/** The licence file a notice points to. */
export function noticeSource(root: string, source: string): string {
  if (source.startsWith(".")) {
    const file = path.resolve(root, source);
    if (!existsSync(file)) throw new Error(`Licence file ${source} not found in ${root}`);
    return file;
  }
  // Packages the kit brings along are found from the kit's own folder, wherever the package manager put it.
  const kit = findPackage("@tavora/official-ui", [root]);
  const folder = findPackage(source, kit ? [root, kit] : [root]);
  const file = folder && readdirSync(folder).find((name) => LICENCE_FILE.test(name));
  if (!folder || !file) throw new Error(`No licence file found for ${source} (looked from ${root})`);
  return path.join(folder, file);
}

/** Copies the licences next to the built pages. */
function noticesPlugin(root: string, notices: Record<string, string>) {
  return {
    name: "tavora-notices",
    closeBundle() {
      const dist = path.join(root, "dist");
      mkdirSync(dist, { recursive: true });
      for (const [name, source] of Object.entries(notices)) cpSync(noticeSource(root, source), path.join(dist, `${name}-LICENSE.txt`));
    },
  };
}

/**
 * Writes dist/THIRD_PARTY_NOTICES.txt from what the build bundled: every npm package in it with its licence texts,
 * and the fonts or data listed in the module's own `third-party.json` (see notices.ts). Every build does it, since
 * Vite empties dist/ first, so a published copy carries the same file as the one that ships in the app. A package
 * without a recognisable licence only warns here; Tavora's own build is the one that fails on it.
 */
function thirdPartyNoticesPlugin(root: string) {
  const ids = new Set<string>();
  return {
    name: "tavora-third-party-notices",
    generateBundle(_options: unknown, bundle: Record<string, { type: string; modules?: Record<string, unknown> }>) {
      for (const file of Object.values(bundle)) if (file.type === "chunk") for (const id of Object.keys(file.modules ?? {})) ids.add(id);
    },
    closeBundle() {
      const read = (file: string): Record<string, unknown> | null => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : null);
      const info = read(path.join(root, "tavora.module.json")) ?? read(path.join(root, "package.json")) ?? {};
      const { notices, text } = noticesFor(root, ids, { name: String(info.name ?? "This module"), version: String(info.version ?? "") });
      for (const problem of notices.problems) console.warn(`[tavora-pack] third-party notices: ${problem.package} ${problem.message}`);
      const dist = path.join(root, "dist");
      mkdirSync(dist, { recursive: true });
      writeFileSync(path.join(dist, "THIRD_PARTY_NOTICES.txt"), text);
    },
  };
}

/**
 * The Vite config of a module: pages in `src/`, built to `dist/` as one self-contained folder (relative paths,
 * nothing loaded from the internet), for Tavora's browser, with the SDK read from its source where the repository
 * has it. Use it as `export default defineConfig(moduleConfig({ pages: ["index", "overlay"], plugins: [vue()] }))`.
 */
export function moduleConfig(options: ModuleConfigOptions = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const input = Object.fromEntries((options.pages ?? ["index"]).map((page) => [page, path.join(root, "src", `${page}.html`)]));
  // `any`: Vite's own plugin types are the module's, not pack's.
  const plugins: any[] = [...(options.plugins ?? []), thirdPartyNoticesPlugin(root), ...(options.notices ? [noticesPlugin(root, options.notices)] : [])];
  return {
    root: path.join(root, "src"),
    base: "./",
    ...(options.publicDir !== undefined ? { publicDir: path.resolve(root, options.publicDir) } : {}),
    plugins,
    resolve: {
      conditions: ["source", ...CLIENT_CONDITIONS],
      dedupe: [...new Set(["vue", "@tavora/sdk", ...(options.dedupe ?? [])])],
      ...(options.alias ? { alias: options.alias } : {}),
    },
    ...(options.define ? { define: options.define } : {}),
    build: {
      outDir: path.join(root, "dist"),
      emptyOutDir: true,
      target: "chrome130",
      modulePreload: { polyfill: false },
      ...(options.chunkSizeWarningLimit ? { chunkSizeWarningLimit: options.chunkSizeWarningLimit } : {}),
      rollupOptions: { input },
    },
  };
}
