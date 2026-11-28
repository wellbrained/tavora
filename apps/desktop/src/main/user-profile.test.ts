import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyLibrary } from "./library";
import { sanitizeProfile } from "./profile";
import { UserProfile } from "./user-profile";

/** A PNG signature and IHDR header for the given size; enough for the checks (profile.ts). */
function png(width = 256, height = 256): string {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString("base64");
}

async function setup() {
  const calls: string[] = [];
  const dir = await mkdtemp(path.join(tmpdir(), "tavora-profile-"));
  const profile = sanitizeProfile({});
  const library = emptyLibrary();
  const user = new UserProfile({
    profile,
    dir,
    pictureUrl: "tavora://app/profile/",
    library,
    save: async () => void calls.push(`saved ${profile.name} ${profile.picture ?? "no picture"}`),
    changed: () => void calls.push("account told"),
    pushState: () => void calls.push("push"),
    now: () => new Date("2026-11-22T10:00:00Z"),
  });
  return { user, calls, dir, profile, library };
}

describe("UserProfile", () => {
  it("saves a new name before the account hears of it", async () => {
    const { user, calls, profile } = await setup();
    await user.rename("Nik", "N K");
    expect(calls).toEqual([`saved ${profile.name} no picture`, "account told"]);
    expect(profile).toMatchObject({ name: "Nik", initials: "NK", updatedAt: "2026-11-22T10:00:00.000Z" });
  });

  it("keeps one picture: a new one replaces the old once saved, and taking it away removes it", async () => {
    const { user, calls, dir, profile } = await setup();
    await user.setPicture(png());
    const first = profile.picture!;
    expect(await readdir(dir)).toEqual([first]);
    await user.setPicture(png());
    expect(await readdir(dir)).toEqual([profile.picture]);
    expect(profile.picture).not.toBe(first);
    await user.setPicture(null);
    expect(await readdir(dir)).toEqual([]);
    expect(calls.filter((call) => call === "account told")).toHaveLength(3);
  });

  it("gives a picture the user took away back, unless there is another by then", async () => {
    const { user, dir, profile } = await setup();
    expect(await user.takePicture()).toBeNull();
    await user.setPicture(png());
    const restore = (await user.takePicture())!;
    expect(await readdir(dir)).toEqual([]);
    expect(await restore()).toBe(true);
    expect(await readdir(dir)).toEqual([profile.picture]);
    expect((await user.data()).picture).toBe(png());
    expect(await restore()).toBe(false);
  });

  it("refuses a picture that isn't a 256 px PNG, and keeps the one it had", async () => {
    const { user, calls, profile } = await setup();
    await expect(user.setPicture(png(10, 10))).rejects.toMatchObject({ key: "error.pictureNotSaved" });
    expect(profile.picture).toBeNull();
    expect(calls).toEqual([]);
  });

  it("gives the account the profile with its picture, and takes the account's in place of this PC's", async () => {
    const { user, calls, dir, profile } = await setup();
    await user.setPicture(png());
    const mine = profile.picture!;
    expect(await user.data()).toEqual({ name: "", initials: "", picture: png(), updatedAt: "2026-11-22T10:00:00.000Z" });

    calls.length = 0;
    await user.apply({ name: "Nik", initials: "", picture: png(), updatedAt: "2026-11-23T08:00:00.000Z" });
    expect(profile).toMatchObject({ name: "Nik", updatedAt: "2026-11-23T08:00:00.000Z" });
    expect(await readdir(dir)).toEqual([profile.picture]);
    expect(profile.picture).not.toBe(mine);
    // Applying is the account's own change: it isn't sent back.
    expect(calls).toEqual([`saved Nik ${profile.picture}`, "push"]);
  });

  it("sends no picture it can't read", async () => {
    const { user, profile } = await setup();
    profile.picture = "avatar-gone.png";
    expect((await user.data()).picture).toBeNull();
  });

  it("shows the card with the picture behind it unless the user chose a banner", async () => {
    const { user, profile, library, dir } = await setup();
    expect(user.view()).toEqual({ name: "", initials: "", pictureUrl: null, ranks: { hidden: false, period: "all" }, banner: "stripes" });
    await writeFile(path.join(dir, "avatar-1.png"), "");
    profile.picture = "avatar-1.png";
    expect(user.view()).toMatchObject({ pictureUrl: "tavora://app/profile/avatar-1.png", banner: "picture" });
    library.profileBanner = "stripes";
    expect(user.view().banner).toBe("stripes");
  });
});
