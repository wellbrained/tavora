import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { systemTool } from "./system-tool";

const root = path.resolve(__dirname, "..", "..", "..", "..");

describe("systemTool", () => {
  it("names Windows' own copy by its full path, never one Windows would look for in the current folder first (audit run 7)", () => {
    expect(systemTool("reg", { SystemRoot: "D:\\Win" })).toBe(path.win32.join("D:\\Win", "System32", "reg.exe"));
    expect(systemTool("taskkill", {})).toBe(path.win32.join("C:\\Windows", "System32", "taskkill.exe"));
    // A root that isn't a full path is no root.
    expect(systemTool("icacls", { SystemRoot: "." })).toBe(path.win32.join("C:\\Windows", "System32", "icacls.exe"));
  });

  it("is how the app and the key tools start reg, taskkill and icacls", () => {
    const files = [
      ...readdirSync(path.join(root, "apps/desktop/src/main"))
        .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
        .map((name) => path.join(root, "apps/desktop/src/main", name)),
      path.join(root, "packages/pack/src/keys.ts"),
      path.join(root, "apps/desktop/scripts/update-key.mjs"),
    ];
    const bare = files.filter((file) => /(?:execFile|execFileSync|spawn|spawnSync)\(\s*["'](?:reg|taskkill|icacls)(?:\.exe)?["']/.test(readFileSync(file, "utf8")));
    expect(bare.map((file) => path.relative(root, file))).toEqual([]);
  });
});
