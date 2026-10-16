import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { contentTypeFor, MODULE_CSP, moduleCsp, resolveAsset } from "./assets";

describe("moduleCsp", () => {
  it("adds WebAssembly to script-src and changes nothing else", () => {
    expect(moduleCsp(false)).toBe(MODULE_CSP);
    const withWasm = moduleCsp(true);
    expect(withWasm).toContain("script-src 'self' 'wasm-unsafe-eval';");
    expect(withWasm.replace(" 'wasm-unsafe-eval'", "")).toBe(MODULE_CSP);
    expect(withWasm).not.toContain("'unsafe-eval'");
    expect(MODULE_CSP).not.toContain("wasm");
  });
});

let root: string;
let outside: string;

beforeAll(async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-assets-")));
  root = path.join(base, "module");
  outside = path.join(base, "secret.txt");
  await mkdir(path.join(root, "dist", "assets"), { recursive: true });
  await writeFile(path.join(root, "dist", "index.html"), "<p>hi</p>");
  await writeFile(path.join(root, "dist", "assets", "app.js"), "1");
  await writeFile(outside, "secret");
  await symlink(outside, path.join(root, "dist", "escape.txt"));
  await symlink(path.dirname(root), path.join(root, "dist", "up"));
  await symlink(path.join(root, "dist", "index.html"), path.join(root, "dist", "alias.html"));
});

describe("resolveAsset", () => {
  it("serves files inside the module root", async () => {
    expect(await resolveAsset(root, "/dist/index.html")).toBe(path.join(root, "dist", "index.html"));
    expect(await resolveAsset(root, "/dist/assets/app.js")).toBe(path.join(root, "dist", "assets", "app.js"));
  });

  it("follows symlinks that stay inside the root", async () => {
    expect(await resolveAsset(root, "/dist/alias.html")).toBe(path.join(root, "dist", "index.html"));
  });

  it.each([
    ["/"],
    ["/dist"],
    ["/dist/"],
    ["/dist/../../secret.txt"],
    ["/dist/%2e%2e/%2e%2e/secret.txt"],
    ["/dist/..%2f..%2fsecret.txt"],
    ["/dist/..%5c..%5csecret.txt"],
    ["/dist/index.html%00.js"],
    ["/dist/%E0%A4%A"],
    ["/dist/escape.txt"],
    ["/dist/up/secret.txt"],
    ["/dist/missing.html"],
    ["//etc/passwd"],
  ])("refuses %s", async (pathname) => {
    expect(await resolveAsset(root, pathname)).toBeNull();
  });
});

describe("contentTypeFor", () => {
  it("maps known extensions and falls back to octet-stream", () => {
    expect(contentTypeFor("a/index.HTML")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("a/app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("a/blob.bin")).toBe("application/octet-stream");
  });
});
