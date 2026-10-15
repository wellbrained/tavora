import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_STEAM_ICON_BYTES,
  findSteamDir,
  iconFileName,
  isIco,
  isIconFileName,
  isIconHash,
  isSteamAppId,
  loadAppInfo,
  needsIcon,
  removeSteamIcon,
  saveSteamIcon,
  steamIconUrl,
} from "./steam-icons";

const HASH = "ab".repeat(20);

/** A valid ICO file with the given frame sizes in bytes. */
function ico(...frameSizes: number[]): Uint8Array {
  const header = 6 + frameSizes.length * 16;
  const total = header + frameSizes.reduce((sum, size) => sum + size, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, frameSizes.length, true);
  let offset = header;
  frameSizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    view.setUint32(entry + 8, size, true);
    view.setUint32(entry + 12, offset, true);
    offset += size;
  });
  return bytes;
}
const ICON = ico(40, 60);

let dir: string;
let steam: string;
let icons: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-icons-"));
  steam = path.join(dir, "Steam");
  icons = path.join(dir, "steam-icons");
  await mkdir(path.join(steam, "steam", "games"), { recursive: true });
  await mkdir(path.join(steam, "appcache"), { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const answer = (body: Uint8Array | string, init: ResponseInit = {}) =>
  (async () => new Response(body as BodyInit, init)) as typeof fetch;

describe("names and addresses", () => {
  it("builds the icon address from the appid and the hash only", () => {
    expect(steamIconUrl(1245620, HASH)).toBe(`https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1245620/${HASH}.ico`);
    expect(steamIconUrl(5, HASH, "http://127.0.0.1:9/x/")).toBe(`http://127.0.0.1:9/x/5/${HASH}.ico`);
  });

  it.each([1, 1245620, 2_147_483_647])("accepts appid %d", (id) => expect(isSteamAppId(id)).toBe(true));
  it.each([0, -1, 1.5, 2_147_483_648, NaN, "12", null, undefined])("refuses appid %j", (id) => expect(isSteamAppId(id)).toBe(false));

  it("only accepts a 40 character lowercase hex hash", () => {
    expect(isIconHash(HASH)).toBe(true);
    for (const bad of ["", "AB".repeat(20), "ab".repeat(19), "../".repeat(14), `${HASH}.ico`, 5, null]) expect(isIconHash(bad)).toBe(false);
  });

  it("only names files that are digits and .ico", () => {
    expect(iconFileName(42)).toBe("42.ico");
    expect(isIconFileName("42.ico")).toBe(true);
    for (const bad of ["../42.ico", "42.jpg", "42", "a.ico", "42.ico/", "", 42, null]) expect(isIconFileName(bad)).toBe(false);
  });
});

describe("isIco", () => {
  it("accepts a real ICO and refuses anything else", () => {
    expect(isIco(ico(100))).toBe(true);
    expect(isIco(ico(10, 10, 10, 10))).toBe(true);
    expect(isIco(new Uint8Array())).toBe(false);
    expect(isIco(new Uint8Array(100))).toBe(false);
    expect(isIco(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(isIco(new TextEncoder().encode("<html><body>not an icon at all</body></html>"))).toBe(false);
  });

  it("refuses a frame table that points outside the file, or a file that is too big", () => {
    const outside = ico(50);
    new DataView(outside.buffer).setUint32(6 + 12, 9999, true);
    expect(isIco(outside)).toBe(false);
    const empty = ico(50);
    new DataView(empty.buffer).setUint32(6 + 8, 0, true);
    expect(isIco(empty)).toBe(false);
    const tooMany = ico(50);
    new DataView(tooMany.buffer).setUint16(4, 500, true);
    expect(isIco(tooMany)).toBe(false);
    expect(isIco(ico(MAX_STEAM_ICON_BYTES))).toBe(false);
  });
});

describe("findSteamDir", () => {
  const present = (...files: string[]) => async (file: string) => files.map((f) => path.normalize(f)).includes(path.normalize(file));

  it("takes the folder the Windows registry names, when Steam's cache is there", async () => {
    const found = await findSteamDir({
      platform: "win32",
      env: {},
      registry: async () => "c:/program files (x86)/steam",
      exists: present("c:/program files (x86)/steam/appcache/appinfo.vdf"),
    });
    expect(found).toBe(path.normalize("c:/program files (x86)/steam"));
  });

  it("falls back to the usual folders, and to nothing", async () => {
    const options = { platform: "win32" as const, env: { "ProgramFiles(x86)": "D:\\Programs (x86)" }, registry: async () => null };
    expect(await findSteamDir({ ...options, exists: present("D:\\Programs (x86)\\Steam\\appcache\\appinfo.vdf") })).toBe(path.normalize("D:\\Programs (x86)\\Steam"));
    expect(await findSteamDir({ ...options, exists: present() })).toBeNull();
  });

  it("ignores a registry folder that has no cache", async () => {
    const found = await findSteamDir({ platform: "win32", env: {}, registry: async () => "E:/gone", exists: present("C:\\Program Files (x86)\\Steam\\appcache\\appinfo.vdf") });
    expect(found).toBe(path.normalize("C:\\Program Files (x86)\\Steam"));
  });

  it("looks in the usual places on Linux and macOS", async () => {
    expect(await findSteamDir({ platform: "linux", home: "/home/p", exists: present("/home/p/.local/share/Steam/appcache/appinfo.vdf") })).toBe(
      path.normalize("/home/p/.local/share/Steam"),
    );
    expect(await findSteamDir({ platform: "darwin", home: "/Users/p", exists: present("/Users/p/Library/Application Support/Steam/appcache/appinfo.vdf") })).toBe(
      path.normalize("/Users/p/Library/Application Support/Steam"),
    );
    expect(await findSteamDir({ platform: "freebsd" as NodeJS.Platform, home: "/h", exists: present() })).toBeNull();
  });
});

describe("loadAppInfo", () => {
  it("reads Steam's cache, and gives null when it is missing", async () => {
    expect(await loadAppInfo(steam)).toBeNull();
    await writeFile(path.join(steam, "appcache", "appinfo.vdf"), new Uint8Array([1, 2, 3]));
    expect([...(await loadAppInfo(steam))!]).toEqual([1, 2, 3]);
  });
});

describe("saveSteamIcon", () => {
  it("copies the icon file Steam keeps on this PC, unchanged, without asking the network", async () => {
    await writeFile(path.join(steam, "steam", "games", `${HASH}.ico`), ICON);
    let asked = false;
    const spy = (async () => ((asked = true), new Response(ICON as BodyInit))) as typeof fetch;
    expect(await saveSteamIcon(icons, steam, 1245620, HASH, { fetchImpl: spy })).toEqual({ status: "saved", file: "1245620.ico" });
    expect(new Uint8Array(await readFile(path.join(icons, "1245620.ico")))).toEqual(ICON);
    expect(asked).toBe(false);
  });

  it("asks Steam's public address when the file is not on disk, and saves it unchanged", async () => {
    expect(await saveSteamIcon(icons, steam, 7, HASH, { fetchImpl: answer(ICON) })).toEqual({ status: "saved", file: "7.ico" });
    expect(new Uint8Array(await readFile(path.join(icons, "7.ico")))).toEqual(ICON);
  });

  it("does not trust a file on disk that is not an icon, and asks the network instead", async () => {
    await writeFile(path.join(steam, "steam", "games", `${HASH}.ico`), "this is not an icon");
    expect(await saveSteamIcon(icons, steam, 7, HASH, { fetchImpl: answer(ICON) })).toEqual({ status: "saved", file: "7.ico" });
    expect(new Uint8Array(await readFile(path.join(icons, "7.ico")))).toEqual(ICON);
  });

  it("sends no cookies or referrer, does not follow redirects, and asks the address it was given", async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined;
    const spy = (async (url: string, init?: RequestInit) => ((seen = { url, init }), new Response(ICON as BodyInit))) as typeof fetch;
    await saveSteamIcon(icons, steam, 7, HASH, { fetchImpl: spy, baseUrl: "http://127.0.0.1:9/icons" });
    expect(seen!.url).toBe(`http://127.0.0.1:9/icons/7/${HASH}.ico`);
    expect(seen!.init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
  });

  it("answers none for an icon Steam does not have, and saves nothing", async () => {
    expect(await saveSteamIcon(icons, steam, 7, HASH, { fetchImpl: answer("no", { status: 404 }) })).toEqual({ status: "none" });
    expect(await saveSteamIcon(icons, steam, 7, HASH, { fetchImpl: answer("no", { status: 403 }) })).toEqual({ status: "none" });
    await expect(readdir(icons)).rejects.toThrow();
  });

  it("answers none when the body is not an icon, is empty or too big", async () => {
    expect(await saveSteamIcon(icons, steam, 7, HASH, { fetchImpl: answer("<html>nope</html>") })).toEqual({ status: "none" });
    expect(await saveSteamIcon(icons, steam, 7, HASH, { fetchImpl: answer(new Uint8Array()) })).toEqual({ status: "none" });
    expect(await saveSteamIcon(icons, steam, 7, HASH, { fetchImpl: answer(new Uint8Array(MAX_STEAM_ICON_BYTES + 1)) })).toEqual({ status: "none" });
    expect(
      await saveSteamIcon(icons, steam, 7, HASH, { fetchImpl: answer(ICON, { headers: { "content-length": String(MAX_STEAM_ICON_BYTES + 1) } }) }),
    ).toEqual({ status: "none" });
  });

  it("answers failed when Steam errors or the network is down, so it is tried again soon", async () => {
    expect(await saveSteamIcon(icons, steam, 7, HASH, { fetchImpl: answer("oops", { status: 500 }) })).toEqual({ status: "failed" });
    const down = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await saveSteamIcon(icons, steam, 7, HASH, { fetchImpl: down })).toEqual({ status: "failed" });
  });

  it("refuses a bad appid or hash without touching the disk or the network", async () => {
    let asked = false;
    const spy = (async () => ((asked = true), new Response(ICON as BodyInit))) as typeof fetch;
    expect(await saveSteamIcon(icons, steam, -5, HASH, { fetchImpl: spy })).toEqual({ status: "none" });
    expect(await saveSteamIcon(icons, steam, 7, "../../etc/passwd", { fetchImpl: spy })).toEqual({ status: "none" });
    expect(await saveSteamIcon(icons, steam, 7, HASH.toUpperCase(), { fetchImpl: spy })).toEqual({ status: "none" });
    expect(asked).toBe(false);
  });
});

describe("removeSteamIcon", () => {
  it("removes an icon and ignores names that are not icon files", async () => {
    await mkdir(icons, { recursive: true });
    await writeFile(path.join(icons, "42.ico"), ICON);
    await writeFile(path.join(icons, "keep.txt"), "x");
    await removeSteamIcon(icons, "42.ico");
    await removeSteamIcon(icons, "keep.txt");
    await removeSteamIcon(icons, "../42.ico");
    expect(await readdir(icons)).toEqual(["keep.txt"]);
  });
});

describe("needsIcon", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const game = (over: Partial<Parameters<typeof needsIcon>[0]> = {}) => ({ steamAppId: 5, iconFile: null, iconCheckedAt: null, ...over });

  it("asks for a game that has an appid and no icon yet", () => expect(needsIcon(game(), now)).toBe(true));
  it("does not ask without an appid or when it has the icon", () => {
    expect(needsIcon(game({ steamAppId: null }), now)).toBe(false);
    expect(needsIcon(game({ iconFile: "5.ico" }), now)).toBe(false);
  });
  it("asks again for a missing icon only after a week", () => {
    expect(needsIcon(game({ iconCheckedAt: "2026-10-10T00:00:00Z" }), now)).toBe(false);
    expect(needsIcon(game({ iconCheckedAt: "2026-10-01T00:00:00Z" }), now)).toBe(true);
    expect(needsIcon(game({ iconCheckedAt: "not a date" }), now)).toBe(true);
  });
});
