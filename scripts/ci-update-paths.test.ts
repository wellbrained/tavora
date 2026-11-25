import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

/** ci.yml's UPDATE_PATHS: the files whose change runs the update check. */
function updatePaths(): RegExp {
  const line = /^\s*UPDATE_PATHS:\s*(.+)$/m.exec(read(".github/workflows/ci.yml"))?.[1];
  if (!line) throw new Error("UPDATE_PATHS not found in ci.yml");
  return new RegExp(line.trim());
}

/**
 * Every repo file updates.ts reaches through its local imports. The host API's types are left out: they change with
 * every feature and say nothing about how an update is checked.
 */
function localImports(start: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || file.endsWith("shared/host-api.ts")) return;
    seen.add(file);
    for (const [, spec] of read(file).matchAll(/^\s*(?:import|export)[^"']*?from\s+["'](\.{1,2}\/[^"']+)["']/gm)) {
      const base = path.posix.join(path.posix.dirname(file), spec!).replace(/\.ts$/, "");
      visit(`${base}.ts`);
    }
  };
  visit(start);
  return [...seen];
}

describe("the update check in CI", () => {
  it("runs for every file the update code imports (hunt 2026-11-25 E8)", () => {
    const paths = updatePaths();
    const files = localImports("apps/desktop/src/main/updates.ts");
    expect(files).toContain("apps/desktop/src/main/fsutil.ts");
    expect(files.filter((file) => !paths.test(file))).toEqual([]);
  });
});
