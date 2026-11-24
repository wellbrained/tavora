import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { iconDataUrl, MAX_MODULE_ICON, moduleIconUrl, pictureDataUrl } from "./module-icon";

/** A PNG's signature and header chunk, saying `width` x `height`. */
const pngOf = (width: number, height: number) => {
  const header = Buffer.alloc(25);
  header.writeUInt32BE(13, 0);
  header.write("IHDR", 4, "latin1");
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), header]);
};
/** A WebP's RIFF header and first chunk of `kind`, saying `width` x `height`; nothing in it would decode. */
const webpOf = (kind: "VP8 " | "VP8L" | "VP8X", width: number, height: number) => {
  let chunk: Buffer;
  if (kind === "VP8L") {
    chunk = Buffer.alloc(5);
    chunk[0] = 0x2f;
    chunk.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 1);
  } else if (kind === "VP8 ") {
    chunk = Buffer.from([0, 0, 0, 0x9d, 0x01, 0x2a, 0, 0, 0, 0]);
    chunk.writeUInt16LE(width, 6);
    chunk.writeUInt16LE(height, 8);
  } else {
    chunk = Buffer.alloc(10);
    chunk.writeUIntLE(width - 1, 4, 3);
    chunk.writeUIntLE(height - 1, 7, 3);
  }
  const body = Buffer.concat([Buffer.from(`WEBP${kind}`), Buffer.from([chunk.length, 0, 0, 0]), chunk]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF"), size, body]);
};
const PNG = pngOf(64, 64);
const WEBP = webpOf("VP8L", 64, 64);

describe("iconDataUrl", () => {
  it("accepts a small PNG or WebP by its signature", () => {
    expect(iconDataUrl(PNG)).toMatch(/^data:image\/png;base64,/);
    expect(iconDataUrl(WEBP)).toMatch(/^data:image\/webp;base64,/);
  });

  it("refuses a picture whose header says more than the limit, however few its bytes (audit run 7)", () => {
    for (const kind of ["VP8 ", "VP8L", "VP8X"] as const) {
      expect(pictureDataUrl(webpOf(kind, 4096, 4096), 1024, 4096)).toMatch(/^data:image\/webp;/);
      expect(pictureDataUrl(webpOf(kind, 4097, 10), 1024, 4096)).toBeNull();
      expect(pictureDataUrl(webpOf(kind, 10, 4097), 1024, 4096)).toBeNull();
    }
    expect(pictureDataUrl(webpOf("VP8X", 16_777_216, 10), 1024, 4096)).toBeNull();
    expect(pictureDataUrl(pngOf(4097, 10), 1024, 4096)).toBeNull();
    expect(pictureDataUrl(pngOf(10, 4096), 1024, 4096)).toMatch(/^data:image\/png;/);
    // A header it can't read says no size at all.
    expect(pictureDataUrl(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]), 1024, 4096)).toBeNull();
    expect(iconDataUrl(pngOf(4097, 4097))).toBeNull();
  });

  it("refuses anything else, including an SVG named like an image, and anything too large", () => {
    expect(iconDataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(iconDataUrl(Buffer.from("tiny"))).toBeNull();
    expect(iconDataUrl(Buffer.concat([PNG, Buffer.alloc(MAX_MODULE_ICON)]))).toBeNull();
  });
});

describe("moduleIconUrl", () => {
  it("reads the manifest's icon from inside the package only", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-icon-")));
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "icon.png"), PNG);
    await writeFile(path.join(root, "assets", "fake.png"), "not a picture");
    expect(await moduleIconUrl(root, "assets/icon.png")).toMatch(/^data:image\/png;base64,/);
    expect(await moduleIconUrl(root, "assets/fake.png")).toBeNull();
    expect(await moduleIconUrl(root, "assets/missing.png")).toBeNull();
    expect(await moduleIconUrl(root, "../outside.png")).toBeNull();
    expect(await moduleIconUrl(root, undefined)).toBeNull();
  });

  it("does not follow a link out of the package", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-icon-")));
    const outside = await mkdtemp(path.join(tmpdir(), "tavora-outside-"));
    await writeFile(path.join(outside, "secret.png"), PNG);
    try {
      await symlink(path.join(outside, "secret.png"), path.join(root, "icon.png"));
    } catch {
      return; // symlinks need rights on some systems
    }
    expect(await moduleIconUrl(root, "icon.png")).toBeNull();
  });
});
