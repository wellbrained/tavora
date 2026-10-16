import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { serveClipboard, type ClipboardDeps } from "./clipboard-http";
import { checkPng, crc32 } from "./png";

const LIMITS = { maxSide: 100, maxPixels: 5000 };

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** A PNG with the given size (the picture data is a plain colour), built the way a PNG is built. */
export function makePng(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * Math.min(height, 4), 0x7f);
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

describe("checkPng", () => {
  it("accepts a complete PNG and reports its size", () => {
    expect(checkPng(makePng(40, 30), LIMITS)).toEqual({ ok: true, width: 40, height: 30 });
  });

  it("refuses a picture beyond the limits", () => {
    expect(checkPng(makePng(101, 10), LIMITS)).toMatchObject({ ok: false });
    expect(checkPng(makePng(90, 90), LIMITS)).toMatchObject({ ok: false });
  });

  it("refuses files that are not PNGs, cut off, damaged or padded", () => {
    const png = makePng(10, 10);
    expect(checkPng(new TextEncoder().encode("GIF89a not a png at all, just some text here"), LIMITS)).toMatchObject({ ok: false });
    expect(checkPng(png.slice(0, png.length - 5), LIMITS)).toMatchObject({ ok: false });
    expect(checkPng(png.slice(0, 30), LIMITS)).toMatchObject({ ok: false });
    const damaged = png.slice();
    damaged[40] = damaged[40]! ^ 0xff;
    expect(checkPng(damaged, LIMITS)).toMatchObject({ ok: false });
    const padded = new Uint8Array(png.length + 3);
    padded.set(png);
    expect(checkPng(padded, LIMITS)).toMatchObject({ ok: false });
    expect(checkPng(new Uint8Array(0), LIMITS)).toMatchObject({ ok: false });
  });
});

describe("serveClipboard", () => {
  function deps(allowed = true) {
    const state = { allowed, consumed: 0, written: [] as Buffer[] };
    const value: ClipboardDeps = {
      allowed: () => state.allowed,
      consume: () => void (state.allowed = false, state.consumed++),
      write: (png) => void state.written.push(png),
    };
    return { state, value };
  }
  const post = (body: Uint8Array | null) => new Request("tavora-module://notes/_clipboard/", { method: "POST", body: body as unknown as BodyInit });

  it("puts a PNG on the clipboard after a click, once per click", async () => {
    const { state, value } = deps();
    const png = makePng(20, 20);
    expect((await serveClipboard(post(png), value)).status).toBe(200);
    expect(state.written).toHaveLength(1);
    expect(new Uint8Array(state.written[0]!)).toEqual(png);
    // The click was used up.
    expect((await serveClipboard(post(png), value)).status).toBe(403);
    expect(state.written).toHaveLength(1);
  });

  it("refuses without a click, before reading anything", async () => {
    const { state, value } = deps(false);
    const response = await serveClipboard(post(makePng(20, 20)), value);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("PERMISSION_DENIED");
    expect(state.written).toEqual([]);
  });

  it("refuses what is not a complete PNG within the limits, and writes nothing", async () => {
    for (const body of [new TextEncoder().encode("not a picture, just some words in a body"), makePng(20, 20).slice(0, 40), makePng(20000, 10)]) {
      const { state, value } = deps();
      const response = await serveClipboard(post(body), value);
      expect(response.status).toBe(415);
      expect(state.written).toEqual([]);
    }
  });

  it("refuses a body over the size limit", async () => {
    const { state, value } = deps();
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set(makePng(10, 10));
    expect((await serveClipboard(post(big), value)).status).toBe(413);
    expect(state.written).toEqual([]);
  });

  it("only takes POST", async () => {
    const { value } = deps();
    expect((await serveClipboard(new Request("tavora-module://notes/_clipboard/"), value)).status).toBe(405);
  });
});
