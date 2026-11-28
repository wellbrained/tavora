import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Everything that runs with a write token or a signing key needs the maintainer's review (audit run 7): the scripts named in
 * CODEOWNERS and every file they load as code, followed through the imports, so a new import can't add an unowned file.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The processes that hold a key or a write token, by their entry script. */
const PRIVILEGED = [
  // The Number job (number.yml, contents: write) runs this on main.
  "apps/desktop/scripts/change-notes.mjs",
  "scripts/trim-changelogs.mjs",
  // These read the update signing key.
  "apps/desktop/scripts/release.mjs",
  "apps/desktop/scripts/release-refresh.mjs",
  "apps/desktop/scripts/update-key.mjs",
  // These sign the catalogue list.
  "scripts/catalog-sign.ts",
  "scripts/catalog-sign-review.ts",
  // These publish the SDK and deploy.
  "scripts/release-sdk.mjs",
  "scripts/deploy-client.mjs",
];

/** What they load without an import statement, or decide what is installed. */
const ALSO = [
  // release.mjs and release-notes.mjs import() it by its path.
  "apps/desktop/src/shared/patch-notes.ts",
  "package.json",
  "apps/desktop/package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "patches/x.patch",
  // This check, and what picks the tests CI runs (audit run 3): unowned, a pull request could change both.
  "scripts/codeowners.test.ts",
  "vitest.config.ts",
];

/** A workspace package's file for a bare import (@tavora/pack, @tavora/sdk/protocol), by its "source" export; null for others. */
function workspaceFile(spec: string): string | null {
  const match = /^@tavora\/([^/]+)(\/.*)?$/.exec(spec);
  if (!match) return null;
  const folder = path.join(root, "packages", match[1]!);
  if (!existsSync(path.join(folder, "package.json"))) return null;
  const exports = (JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")) as { exports?: Record<string, { source?: string }> }).exports ?? {};
  const source = exports[match[2] ? `.${match[2]}` : "."]?.source;
  return source ? path.join(folder, source) : null;
}

/** The package.json whose exports pick the file for a bare workspace import, or null. */
function workspacePackageFile(spec: string): string | null {
  const match = /^@tavora\/([^/]+)/.exec(spec);
  const file = match ? path.join(root, "packages", match[1]!, "package.json") : null;
  return file && existsSync(file) ? file : null;
}

/**
 * Every repository file `entries` load as code, and the package.json of each workspace package they import by name: its
 * exports decide which file loads (audit run 3). Type-only imports load nothing.
 */
function loaded(entries: string[]): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    const pattern = /^\s*(?:import|export)\s+(?!type\s)(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm;
    for (const found of text.matchAll(pattern)) {
      const spec = found[1] ?? found[2]!;
      const packageFile = spec.startsWith(".") ? null : workspacePackageFile(spec);
      if (packageFile) seen.add(packageFile);
      let next = spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : workspaceFile(spec);
      if (!next) continue;
      if (!existsSync(next) && next.endsWith(".js")) next = `${next.slice(0, -3)}.ts`;
      if (existsSync(next)) visit(next);
    }
  };
  for (const entry of entries) visit(path.join(root, entry));
  return [...seen].map((file) => path.relative(root, file).replaceAll("\\", "/")).sort();
}

/** The owner rules, as GitHub reads them for these: anchored paths, a folder by its trailing slash, `*` within a name. */
function owned(rules: string[], file: string): boolean {
  return rules.some((rule) => {
    const pattern = rule.replace(/^\//, "");
    if (pattern.endsWith("/")) return file.startsWith(pattern);
    const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
    return regex.test(file);
  });
}

describe("CODEOWNERS", () => {
  const rules = readFileSync(path.join(root, ".github", "CODEOWNERS"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.split(/\s+/)[0]!);

  it("owns every file that runs with a write token or a signing key, and what decides the installed packages (audit run 7)", () => {
    const files = [...loaded(PRIVILEGED), ...ALSO];
    expect(files).toContain("apps/desktop/scripts/installed-version.mjs");
    expect(files).toContain("apps/desktop/src/shared/release-catalog.ts");
    expect(files).toContain("packages/module-schema/package.json");
    expect(files).toContain("packages/sdk/package.json");
    expect(files.filter((file) => !owned(rules, file))).toEqual([]);
  });

  it("reads the rules as GitHub does", () => {
    expect(owned(["/apps/desktop/scripts/release*.mjs"], "apps/desktop/scripts/release-guards.mjs")).toBe(true);
    expect(owned(["/apps/desktop/scripts/release*.mjs"], "apps/desktop/scripts/sub/release.mjs")).toBe(false);
    expect(owned(["/patches/"], "patches/a.patch")).toBe(true);
    expect(owned(["/package.json"], "apps/desktop/package.json")).toBe(false);
  });
});
