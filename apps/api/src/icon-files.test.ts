import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addIcon, IconFileError, removeIcon } from "./icon-files.ts";
import { loadIconStore } from "./icons.ts";
import { encodePng } from "./png.ts";

const png = (seed: number) => encodePng(8, 8, Uint8Array.from({ length: 8 * 8 * 4 }, (_, i) => (i * seed) % 256));

/** An .ico holding one PNG frame. */
function icoOf(frame: Uint8Array): Uint8Array {
  const out = new Uint8Array(22 + frame.byteLength);
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, 1, true);
  out[6] = 8;
  out[7] = 8;
  v.setUint32(14, frame.byteLength, true);
  v.setUint32(18, 22, true);
  out.set(frame, 22);
  return out;
}

let dir: string;
beforeEach(() => {
  dir = path.join(mkdtempSync(path.join(tmpdir(), "tavora-iconfiles-")), "icons");
});
afterEach(() => rmSync(path.dirname(dir), { recursive: true, force: true }));

const now = new Date("2026-10-15T12:00:00Z");

describe("addIcon", () => {
  it("stores a PNG and records it, so the store serves it", () => {
    const file = png(3);
    const result = addIcon(dir, { id: "diablo-iv", names: ["Diablo IV", " Diablo 4 "], bytes: file, source: "installed game", now });
    expect(result).toMatchObject({ id: "diablo-iv", size: file.byteLength });
    expect(new Uint8Array(readFileSync(path.join(dir, "diablo-iv.png")))).toEqual(file);
    const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as { icons: unknown[] };
    expect(index.icons).toEqual([{ id: "diablo-iv", names: ["Diablo IV", "Diablo 4"], sha256: result.sha256, source: "installed game", addedAt: now.toISOString() }]);
    const store = loadIconStore(dir);
    expect(store.list().map((icon) => icon.id)).toEqual(["diablo-iv"]);
    expect(store.file("diablo-iv")).toEqual(file);
  });

  it("turns an .ico into its biggest frame as a PNG, unchanged when it already is one", () => {
    const frame = png(5);
    addIcon(dir, { id: "game", names: ["Game"], bytes: icoOf(frame), source: "s" });
    expect(new Uint8Array(readFileSync(path.join(dir, "game.png")))).toEqual(frame);
  });

  it("replaces an icon with the same id and keeps the index sorted without leftovers", () => {
    addIcon(dir, { id: "b-game", names: ["B"], bytes: png(3), source: "s" });
    addIcon(dir, { id: "a-game", names: ["A"], bytes: png(4), source: "s" });
    addIcon(dir, { id: "b-game", names: ["B again"], bytes: png(7), source: "s" });
    const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as { icons: { id: string; names: string[] }[] };
    expect(index.icons.map((icon) => [icon.id, icon.names[0]])).toEqual([["a-game", "A"], ["b-game", "B again"]]);
    expect(readdirSync(dir).sort()).toEqual(["a-game.png", "b-game.png", "index.json"]);
  });

  it("refuses a bad id, bad names, no source and bytes that are not an icon", () => {
    const ok = { id: "game", names: ["Game"], bytes: png(3), source: "s" };
    for (const bad of [
      { ...ok, id: "../game" },
      { ...ok, id: "Game" },
      { ...ok, names: [] },
      { ...ok, names: ["  "] },
      { ...ok, names: Array.from({ length: 9 }, (_, i) => `n${i}`) },
      { ...ok, names: ["x".repeat(121)] },
      { ...ok, source: " " },
      { ...ok, bytes: new Uint8Array(100) },
      { ...ok, bytes: encodePng(300, 4, new Uint8Array(300 * 4 * 4)) },
    ]) {
      expect(() => addIcon(dir, bad)).toThrow(IconFileError);
    }
    expect(() => readFileSync(path.join(dir, "index.json"))).toThrow();
  });
});

describe("removeIcon", () => {
  it("removes the file and its entry, and says whether there was one", () => {
    addIcon(dir, { id: "game", names: ["Game"], bytes: png(3), source: "s" });
    addIcon(dir, { id: "other", names: ["Other"], bytes: png(4), source: "s" });
    expect(removeIcon(dir, "game")).toBe(true);
    expect(removeIcon(dir, "game")).toBe(false);
    expect(readdirSync(dir).sort()).toEqual(["index.json", "other.png"]);
    expect(loadIconStore(dir).list().map((icon) => icon.id)).toEqual(["other"]);
  });

  it("removes a file the index no longer lists, and refuses an id that is not safe", () => {
    addIcon(dir, { id: "game", names: ["Game"], bytes: png(3), source: "s" });
    writeFileSync(path.join(dir, "stray.png"), png(9));
    expect(removeIcon(dir, "stray")).toBe(true);
    expect(readdirSync(dir)).not.toContain("stray.png");
    expect(() => removeIcon(dir, "../index")).toThrow(IconFileError);
  });

  it("does nothing in a folder that does not exist", () => {
    expect(removeIcon(path.join(dir, "nope"), "game")).toBe(false);
  });
});
