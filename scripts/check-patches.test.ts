import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addedLines, checkPatches, parseSpec, storeFolders } from "./check-patches.mjs";

const PATCH = `diff --git a/dist/index.js b/dist/index.js
index 1111111..2222222 100644
--- a/dist/index.js
+++ b/dist/index.js
@@ -1,3 +1,4 @@
 var a = 1;
+// Tavora: ten colours.
-var b = 2;
+var b = 10;
+
 var c = 3;
`;
const ORIGINAL = "var a = 1;\nvar b = 2;\nvar c = 3;\n";
const PATCHED = "var a = 1;\r\n// Tavora: ten colours.\r\nvar b = 10;\r\n\r\nvar c = 3;\r\n";

/** A repo with one patched dependency, installed in the given .pnpm folders with the given contents. */
function repo(copies: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "check-patches-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ pnpm: { patchedDependencies: { "@scope/pkg@1.2.3": "patches/pkg.patch" } } }));
  mkdirSync(path.join(root, "patches"));
  writeFileSync(path.join(root, "patches", "pkg.patch"), PATCH);
  for (const [folder, text] of Object.entries(copies)) {
    const dir = path.join(root, "node_modules", ".pnpm", folder, "node_modules", "@scope", "pkg", "dist");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.js"), text);
    writeFileSync(path.join(dir, "..", "package.json"), JSON.stringify({ version: folder.includes("@2.0.0") ? "2.0.0" : "1.2.3" }));
  }
  return root;
}

describe("check-patches", () => {
  it("reads the added lines of each file, without blank ones", () => {
    expect(addedLines(PATCH)).toEqual({ "dist/index.js": ["// Tavora: ten colours.", "var b = 10;"] });
  });

  it("finds every store folder of that version, also under a shortened name", () => {
    const root = repo({ "@scope+pkg@1.2_d18653": PATCHED, "@scope+pkg@1.2.3": PATCHED, "@scope+pkg@2.0.0": PATCHED });
    const store = path.join(root, "node_modules", ".pnpm");
    const entries = ["@scope+pkg@1.2_d18653", "@scope+pkg@1.2.3", "@scope+pkg@2.0.0", "other@1.2.3"];
    expect(storeFolders(store, entries, "@scope/pkg", "1.2.3")).toEqual(["@scope+pkg@1.2_d18653", "@scope+pkg@1.2.3"]);
    expect(parseSpec("@scope/pkg@1.2.3")).toEqual({ name: "@scope/pkg", version: "1.2.3" });
  });

  it("passes when every copy is patched", () => {
    expect(checkPatches(repo({ "@scope+pkg@1.2.3_patch_hash=abc": PATCHED }))).toEqual([]);
  });

  it("names an unpatched copy and how to fix it", () => {
    const problems = checkPatches(repo({ "@scope+pkg@1.2.3_patch_hash=abc": PATCHED, "@scope+pkg@1.2.3_patch_hash=def": ORIGINAL }));
    expect(problems).toEqual([
      "@scope/pkg@1.2.3 is not patched in node_modules/.pnpm/@scope+pkg@1.2.3_patch_hash=def (dist/index.js). Delete that folder and run pnpm install --frozen-lockfile.",
    ]);
  });

  it("says when the dependency is not installed at all", () => {
    expect(checkPatches(repo({}))[0]).toMatch(/is not installed .*pnpm install --frozen-lockfile/);
  });
});
