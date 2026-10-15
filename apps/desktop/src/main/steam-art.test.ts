import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_ART_BYTES,
  artFileName,
  fetchSteamArt,
  isArtFileName,
  isSteamAppId,
  needsArt,
  removeSteamArt,
  steamArtUrl,
} from "./steam-art";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-art-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const answer = (body: Uint8Array | string, init: ResponseInit = {}) => (async () => new Response(body as BodyInit, init)) as typeof fetch;
const ask = (appid: number, fetchImpl: typeof fetch) => fetchSteamArt(dir, appid, { fetchImpl });

describe("steamArtUrl and ids", () => {
  it("builds the cover address from the appid only", () => {
    expect(steamArtUrl(1245620)).toBe("https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/library_600x900.jpg");
  });

  it("can point at another server for tests and development", () => {
    expect(steamArtUrl(5, "http://127.0.0.1:9/art/")).toBe("http://127.0.0.1:9/art/5/library_600x900.jpg");
  });

  it.each([1, 1245620, 2_147_483_647])("accepts appid %d", (id) => expect(isSteamAppId(id)).toBe(true));
  it.each([0, -1, 1.5, 2_147_483_648, NaN, "12", null, undefined])("refuses appid %j", (id) => expect(isSteamAppId(id)).toBe(false));

  it("only names files that are digits and .jpg", () => {
    expect(artFileName(42)).toBe("42.jpg");
    expect(isArtFileName("42.jpg")).toBe(true);
    for (const bad of ["../42.jpg", "42.png", "42", "a.jpg", "42.jpg/", "", 42, null]) expect(isArtFileName(bad)).toBe(false);
  });
});

describe("fetchSteamArt", () => {
  it("saves a JPEG unchanged", async () => {
    expect(await ask(1245620, answer(JPEG, { status: 200 }))).toEqual({ status: "saved", file: "1245620.jpg" });
    expect(new Uint8Array(await readFile(path.join(dir, "1245620.jpg")))).toEqual(JPEG);
  });

  it("sends no cookies or referrer and does not follow redirects", async () => {
    let seen: RequestInit | undefined;
    const spy = (async (_url: string, init?: RequestInit) => {
      seen = init;
      return new Response(JPEG);
    }) as typeof fetch;
    await ask(7, spy);
    expect(seen).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
  });

  it("asks the address it was given", async () => {
    let asked = "";
    const spy = (async (url: string) => {
      asked = url;
      return new Response(JPEG);
    }) as typeof fetch;
    await fetchSteamArt(dir, 7, { fetchImpl: spy, baseUrl: "http://127.0.0.1:9/art" });
    expect(asked).toBe("http://127.0.0.1:9/art/7/library_600x900.jpg");
  });

  it("answers none for a missing cover, and saves nothing", async () => {
    expect(await ask(9, answer("no", { status: 404 }))).toEqual({ status: "none" });
    expect(await readdir(dir)).toEqual([]);
  });

  it("answers none when the body is not a JPEG, is empty or too big", async () => {
    expect(await ask(9, answer(PNG))).toEqual({ status: "none" });
    expect(await ask(9, answer(new Uint8Array()))).toEqual({ status: "none" });
    expect(await ask(9, answer(new Uint8Array(MAX_ART_BYTES + 1).fill(0xff)))).toEqual({ status: "none" });
    expect(await ask(9, answer(JPEG, { headers: { "content-length": String(MAX_ART_BYTES + 1) } }))).toEqual({ status: "none" });
    expect(await readdir(dir)).toEqual([]);
  });

  it("answers failed when Steam errors or the network is down, so it is tried again soon", async () => {
    expect(await ask(9, answer("oops", { status: 500 }))).toEqual({ status: "failed" });
    const down = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await ask(9, down)).toEqual({ status: "failed" });
  });

  it("refuses an invalid appid without asking Steam", async () => {
    let asked = false;
    const spy = (async () => {
      asked = true;
      return new Response(JPEG);
    }) as typeof fetch;
    expect(await ask(-5, spy)).toEqual({ status: "none" });
    expect(asked).toBe(false);
  });
});

describe("removeSteamArt", () => {
  it("removes a cover and ignores names that are not cover files", async () => {
    await writeFile(path.join(dir, "42.jpg"), JPEG);
    await writeFile(path.join(dir, "keep.txt"), "x");
    await removeSteamArt(dir, "42.jpg");
    await removeSteamArt(dir, "keep.txt");
    await removeSteamArt(dir, "../42.jpg");
    expect(await readdir(dir)).toEqual(["keep.txt"]);
  });
});

describe("needsArt", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const game = (over: Partial<Parameters<typeof needsArt>[0]> = {}) => ({ steamAppId: 5, artFile: null, artCheckedAt: null, ...over });

  it("asks for a game that has an appid and no cover yet", () => expect(needsArt(game(), now)).toBe(true));
  it("does not ask without an appid or when it has the cover", () => {
    expect(needsArt(game({ steamAppId: null }), now)).toBe(false);
    expect(needsArt(game({ artFile: "5.jpg" }), now)).toBe(false);
  });
  it("asks again for a missing cover only after 30 days", () => {
    expect(needsArt(game({ artCheckedAt: "2026-10-01T00:00:00Z" }), now)).toBe(false);
    expect(needsArt(game({ artCheckedAt: "2026-09-01T00:00:00Z" }), now)).toBe(true);
    expect(needsArt(game({ artCheckedAt: "not a date" }), now)).toBe(true);
  });
});
