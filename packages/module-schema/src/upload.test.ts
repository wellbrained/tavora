// Bug hunt D (2026-11-25) M2: what the catalog refuses after an upload is checked before it is sent.
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { catalogUploadProblem, describeUploadProblem, MAX_README_BYTES, MAX_SCREENSHOT_BYTES, UPLOAD_BUDGET_BYTES } from "./index";

/** A PNG of this size: signature, IHDR, one IDAT and IEND with right checksums. */
function png(width: number, height: number, extra = 0): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    new DataView(out.buffer).setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", new Uint8Array(1 + extra)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
/** A lossless WebP of this size, by its header only. */
function webp(width: number, height: number): Uint8Array {
  const out = new Uint8Array(30);
  const view = new DataView(out.buffer);
  out.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  view.setUint32(4, out.length - 8, true);
  out.set([..."WEBPVP8L"].map((c) => c.charCodeAt(0)), 8);
  view.setUint32(16, 10, true);
  out[20] = 0x2f;
  view.setUint32(21, (width - 1) | ((height - 1) << 14), true);
  return out;
}
const text = (value: string) => new TextEncoder().encode(value);
const manifest = { version: "1.0.0", games: [] as string[], readme: "README.md", screenshots: ["shots/a.png", "shots/b.webp"] };
const files = (extra: Record<string, Uint8Array> = {}) =>
  Object.entries({ "README.md": text("# Hi\n\nPlans builds.\r\n"), "shots/a.png": png(800, 600), "shots/b.webp": webp(800, 600), ...extra }).map(([name, data]) => ({ name, data }));

describe("catalogUploadProblem", () => {
  it("passes a module the catalog takes", () => {
    expect(catalogUploadProblem(manifest, files(), 1000)).toBeNull();
    expect(catalogUploadProblem({ version: "1.0.0", games: [] }, [], 10)).toBeNull();
  });

  it("refuses what the catalog lists no more: a long version, too many games", () => {
    expect(catalogUploadProblem({ ...manifest, version: `1.0.${"1".repeat(70)}` }, files(), 1000)).toEqual({ kind: "version", max: 64 });
    const games = Array.from({ length: 101 }, (_, at) => `game-${at}`);
    expect(catalogUploadProblem({ ...manifest, games }, files(), 1000)).toEqual({ kind: "games", count: 101, max: 100 });
  });

  it("refuses a readme that isn't plain text, is too big or is missing", () => {
    expect(catalogUploadProblem(manifest, files({ "README.md": text("a\u0000b") }), 1000)).toEqual({ kind: "readme", file: "README.md" });
    expect(catalogUploadProblem(manifest, files({ "README.md": Uint8Array.from([0xff, 0xfe, 0x41]) }), 1000)).toEqual({ kind: "readme", file: "README.md" });
    expect(catalogUploadProblem(manifest, files({ "README.md": text("x".repeat(MAX_README_BYTES + 1)) }), 1000)).toEqual({ kind: "readme", file: "README.md" });
    expect(catalogUploadProblem(manifest, files().filter((file) => file.name !== "README.md"), 1000)).toEqual({ kind: "readme", file: "README.md" });
  });

  it("refuses a screenshot that isn't the picture it is named as, is too big or too large", () => {
    expect(catalogUploadProblem(manifest, files({ "shots/a.png": text("not a picture") }), 1000)).toEqual({ kind: "screenshot", file: "shots/a.png" });
    expect(catalogUploadProblem(manifest, files({ "shots/a.png": webp(10, 10) }), 1000)).toEqual({ kind: "screenshot", file: "shots/a.png" });
    expect(catalogUploadProblem(manifest, files({ "shots/b.webp": png(10, 10) }), 1000)).toEqual({ kind: "screenshot", file: "shots/b.webp" });
    expect(catalogUploadProblem(manifest, files({ "shots/a.png": png(4097, 10) }), 1000)).toEqual({ kind: "screenshot", file: "shots/a.png" });
    expect(catalogUploadProblem(manifest, files({ "shots/b.webp": webp(4096, 4097) }), 1000)).toEqual({ kind: "screenshot", file: "shots/b.webp" });
    expect(catalogUploadProblem(manifest, files({ "shots/a.png": png(10, 10, MAX_SCREENSHOT_BYTES) }), 1000)).toEqual({ kind: "screenshot", file: "shots/a.png" });
    // A damaged part, a header cut short or a missing picture: the catalog refuses these after the upload, so they are told before it.
    const damaged = png(10, 10);
    damaged[41] = damaged[41]! ^ 0xff;
    expect(catalogUploadProblem(manifest, files({ "shots/a.png": damaged }), 1000)).toEqual({ kind: "screenshot", file: "shots/a.png" });
    expect(catalogUploadProblem(manifest, files({ "shots/a.png": png(10, 10) }), 1000)).toBeNull();
  });

  it("refuses a module whose zip and files together go over the catalog's budget", () => {
    const big = { name: "dist/data.bin", data: new Uint8Array(60 * 1024 * 1024) };
    expect(catalogUploadProblem(manifest, [...files(), big], 30 * 1024 * 1024)).toEqual({ kind: "too-big", maxBytes: UPLOAD_BUDGET_BYTES });
    expect(catalogUploadProblem(manifest, [...files(), big], 10 * 1024 * 1024)).toBeNull();
  });

  it("says each problem in a sentence", () => {
    expect(describeUploadProblem({ kind: "screenshot", file: "shots/b.webp" })).toBe("Its screenshot shots/b.webp is not a WebP of at most 1 MB and 4096 px.");
    expect(describeUploadProblem({ kind: "too-big", maxBytes: UPLOAD_BUDGET_BYTES })).toContain("88 MB");
  });
});
