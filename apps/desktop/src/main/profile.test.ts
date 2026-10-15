import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IconError } from "./icons";
import { clipName, MAX_PROFILE_NAME, pngSize, removePicture, sanitizeProfile, savePicture } from "./profile";

/** A PNG signature and IHDR header for the given size; enough for the checks. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe("sanitizeProfile", () => {
  it("starts a new profile with a fresh id, no name and no picture", () => {
    const profile = sanitizeProfile(null);
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(profile).toMatchObject({ version: 1, name: "", picture: null });
  });

  it("keeps a saved profile and drops what it does not recognise", () => {
    const id = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    expect(sanitizeProfile({ id, name: "Brain", picture: "avatar-0a1b2c3d.png", email: "x" })).toEqual({
      version: 1,
      id,
      name: "Brain",
      picture: "avatar-0a1b2c3d.png",
    });
    const broken = sanitizeProfile({ id: "nope", name: 3, picture: "../secret.png" });
    expect(broken.id).not.toBe("nope");
    expect(broken).toMatchObject({ name: "", picture: null });
  });
});

describe("clipName", () => {
  it("keeps names to the limit, counting emoji as one character", () => {
    expect([...clipName("🐉".repeat(40))]).toHaveLength(MAX_PROFILE_NAME);
    expect(clipName("Line\none")).toBe("Line one");
  });
});

describe("pictures", () => {
  let dir: string;
  beforeEach(async () => (dir = await mkdtemp(path.join(tmpdir(), "tavora-profile-"))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("reads the size of a PNG", () => {
    expect(pngSize(png(256, 128))).toEqual({ width: 256, height: 128 });
    expect(pngSize(Buffer.from("not a png at all, really not"))).toBeNull();
  });

  it("stores a 256 px PNG and removes it again", async () => {
    const file = await savePicture(dir, png(256, 256).toString("base64"));
    expect(file).toMatch(/^avatar-[0-9a-f]{8}\.png$/);
    expect(await readFile(path.join(dir, file))).toEqual(png(256, 256));
    await removePicture(dir, file);
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses anything that is not a 256 px PNG", async () => {
    await expect(savePicture(dir, png(512, 512).toString("base64"))).rejects.toThrow(IconError);
    await expect(savePicture(dir, Buffer.from("GIF89a").toString("base64"))).rejects.toThrow(IconError);
    expect(await readdir(dir)).toEqual([]);
  });
});
