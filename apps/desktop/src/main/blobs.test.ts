import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { serveBlobs } from "./blob-http";
import { BlobStore, sniffType } from "./blobs";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

/** A stream of the given pieces, like a request body. */
async function* pieces(...parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield part;
}

let dir: string;
let store: BlobStore;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "tavora-blobs-")), "notes", "poe2");
  store = new BlobStore(() => dir, { maxFileBytes: 100, maxTotalBytes: 150 });
});

describe("sniffType", () => {
  it("knows the four picture kinds by their first bytes", () => {
    expect(sniffType(PNG)).toBe("image/png");
    expect(sniffType(JPEG)).toBe("image/jpeg");
    expect(sniffType(GIF)).toBe("image/gif");
    expect(sniffType(WEBP)).toBe("image/webp");
  });

  it("refuses everything else, including text, SVG and BMP", () => {
    for (const text of ["hello world, this is text", "<svg xmlns='http://www.w3.org/2000/svg'/>", "BM\u0000\u0000\u0000\u0000"]) {
      expect(sniffType(new TextEncoder().encode(text))).toBeNull();
    }
    expect(sniffType(new Uint8Array(0))).toBeNull();
  });
});

describe("BlobStore.put", () => {
  it("stores a picture under a host-chosen id and lists it", async () => {
    const info = await store.put(pieces(PNG.slice(0, 5), PNG.slice(5)));
    expect(info).toMatchObject({ bytes: PNG.length, type: "image/png" });
    expect(info.id).toMatch(/^[a-f0-9]{32}$/);
    expect(await store.list()).toEqual([info]);
    expect(await readdir(dir)).toEqual([`${info.id}.png`]);
    expect(await store.usage()).toEqual({ bytes: PNG.length, count: 1, maxBytes: 150, maxFileBytes: 100 });
  });

  it("goes by what the file is, never by what it is called or claims to be", async () => {
    expect((await store.put(pieces(JPEG))).type).toBe("image/jpeg");
    expect((await store.put(pieces(GIF))).type).toBe("image/gif");
    expect((await store.put(pieces(WEBP))).type).toBe("image/webp");
  });

  it("refuses anything that is not a picture, and leaves nothing behind", async () => {
    await expect(store.put(pieces(new TextEncoder().encode("this is not a picture at all")))).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    await expect(store.put(pieces(new Uint8Array(0)))).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    await expect(store.put(pieces(PNG.slice(0, 4)))).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses a file over the file limit, from the declared size or while it arrives", async () => {
    await expect(store.put(pieces(PNG), 101)).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    const big = new Uint8Array(101);
    big.set(PNG);
    await expect(store.put(pieces(big.slice(0, 50), big.slice(50)))).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses a file that would take the module past its total", async () => {
    const eighty = new Uint8Array(80);
    eighty.set(PNG);
    await store.put(pieces(eighty));
    await expect(store.put(pieces(eighty))).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect((await store.usage()).count).toBe(1);
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("removes leftovers of a write that was cut off", async () => {
    await store.put(pieces(PNG));
    await writeFile(path.join(dir, "0123456789abcdef0123456789abcdef.tmp"), "half");
    await store.list();
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("BlobStore.delete and open", () => {
  it("deletes a file and ignores a missing one", async () => {
    const info = await store.put(pieces(PNG));
    await store.delete(info.id);
    await store.delete(info.id);
    expect(await store.list()).toEqual([]);
  });

  it("refuses ids that are not ours, so no path can be built from them", async () => {
    for (const id of ["../x", "a".repeat(31), "A".repeat(32), "", 4, null, "0123456789abcdef0123456789abcdef.png"]) {
      expect(() => store.delete(id)).toThrow();
      expect(await store.open(id)).toBeNull();
    }
  });

  it("finds a stored file for serving", async () => {
    const info = await store.put(pieces(GIF));
    expect(await store.open(info.id)).toMatchObject({ type: "image/gif", bytes: GIF.length });
    expect(await store.open("0".repeat(32))).toBeNull();
  });
});

describe("serveBlobs", () => {
  const url = (rest: string) => new URL(`tavora-module://notes/_blobs/${rest}`);
  const post = (body: Uint8Array) => new Request(url("").href, { method: "POST", body: body as unknown as BodyInit, headers: { "content-length": String(body.length) } });

  it("stores a posted picture and serves it back with safe headers", async () => {
    const stored = await serveBlobs(store, post(PNG), url(""));
    expect(stored.status).toBe(201);
    const info = (await stored.json()) as { id: string; type: string };
    const served = await serveBlobs(store, new Request(url(info.id).href), url(info.id));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
  });

  it("answers a refused file with the error and a fitting status", async () => {
    const text = await serveBlobs(store, post(new TextEncoder().encode("not a picture, just words")), url(""));
    expect(text.status).toBe(415);
    expect(((await text.json()) as { error: { code: string } }).error.code).toBe("INVALID_PARAMS");
    const big = new Uint8Array(101);
    big.set(PNG);
    expect((await serveBlobs(store, post(big), url(""))).status).toBe(413);
  });

  it("knows nothing about other paths or methods", async () => {
    expect((await serveBlobs(store, new Request(url("nope").href), url("nope"))).status).toBe(404);
    expect((await serveBlobs(store, new Request(url("0".repeat(32)).href), url("0".repeat(32)))).status).toBe(404);
    expect((await serveBlobs(store, new Request(url("").href), url(""))).status).toBe(405);
    expect((await serveBlobs(store, new Request(url("0".repeat(32)).href, { method: "DELETE" }), url("0".repeat(32)))).status).toBe(405);
  });
});
