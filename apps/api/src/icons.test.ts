import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isIconId, loadIconStore } from "./icons.ts";
import { encodePng } from "./png.ts";

const picture = (seed: number) => encodePng(8, 8, Uint8Array.from({ length: 8 * 8 * 4 }, (_, i) => (i * seed) % 256));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tavora-icons-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, content: Uint8Array | string) => writeFileSync(path.join(dir, name), content);
const index = (...icons: unknown[]) => write("index.json", JSON.stringify({ icons }));

describe("loadIconStore", () => {
  it("serves an icon whose file matches its recorded hash, with its names", () => {
    const png = picture(3);
    write("diablo-iv.png", png);
    index({ id: "diablo-iv", names: ["Diablo IV", " Diablo 4 "], sha256: sha(png), source: "installed game" });
    const store = loadIconStore(dir);
    expect(store.list()).toEqual([{ id: "diablo-iv", names: ["Diablo IV", "Diablo 4"], sha256: sha(png), size: png.byteLength }]);
    expect(store.file("diablo-iv")).toEqual(png);
    expect(store.file("other")).toBeNull();
  });

  it("serves nothing when there is no index or it is unreadable", () => {
    const warnings: string[] = [];
    expect(loadIconStore(dir, (m) => warnings.push(m)).list()).toEqual([]);
    write("index.json", "{ nope");
    expect(loadIconStore(dir, (m) => warnings.push(m)).list()).toEqual([]);
    write("index.json", JSON.stringify({ icons: "x" }));
    expect(loadIconStore(dir, (m) => warnings.push(m)).list()).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  it("leaves out, and reports, every entry that cannot be trusted", () => {
    const good = picture(5);
    write("ok.png", good);
    write("changed.png", picture(7));
    write("text.png", "not a png at all, only text, long enough to pass for a file");
    write("big.png", encodePng(8, 8, new Uint8Array(8 * 8 * 4)));
    const names = ["A"];
    index(
      { id: "ok", names, sha256: sha(good) },
      { id: "ok", names, sha256: sha(good) },
      { id: "changed", names, sha256: sha(picture(9)) },
      { id: "text", names, sha256: "0".repeat(64) },
      { id: "missing", names, sha256: "0".repeat(64) },
      { id: "../escape", names, sha256: sha(good) },
      { id: "Upper", names, sha256: sha(good) },
      { id: "nonames", names: [], sha256: sha(good) },
      { id: "nohash", names, sha256: "abc" },
      { id: "toolong", names: ["x".repeat(121)], sha256: sha(good) },
      null,
      "string",
    );
    const warnings: string[] = [];
    const store = loadIconStore(dir, (m) => warnings.push(m));
    expect(store.list().map((icon) => icon.id)).toEqual(["ok"]);
    expect(warnings.some((m) => m.includes("changed") && m.includes("hash"))).toBe(true);
    expect(warnings.some((m) => m.includes("text") && m.includes("PNG"))).toBe(true);
    expect(warnings.some((m) => m.includes("missing"))).toBe(true);
  });

  it("only accepts ids that are safe file names", () => {
    for (const id of ["diablo-iv", "a", "7", "a".repeat(64)]) expect(isIconId(id)).toBe(true);
    for (const id of ["", "Diablo", "-a", "a/b", "a.png", "../a", "a".repeat(65), 5, null]) expect(isIconId(id)).toBe(false);
  });
});
