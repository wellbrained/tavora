import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_STEAM_ICON_BYTES,
  exeIconFileName,
  fetchPublicIconHash,
  findSteamDir,
  iconFileAllowed,
  iconFileName,
  isIco,
  isIconFileName,
  isIconHash,
  isJpeg,
  isSteamAppId,
  loadAppInfo,
  needsIcon,
  publicIconFileName,
  removeSteamIcon,
  saveExeIcon,
  savePublicSteamIcon,
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

  it("only names files that are digits with .ico or .jpg, or exe- and a game id with .ico", () => {
    expect(iconFileName(42)).toBe("42.ico");
    expect(publicIconFileName(42)).toBe("42.jpg");
    expect(exeIconFileName("diablo-iv")).toBe("exe-diablo-iv.ico");
    for (const good of ["42.ico", "42.jpg", "exe-diablo-iv.ico", "exe-7.ico"]) expect(isIconFileName(good)).toBe(true);
    for (const bad of ["../42.ico", "42.png", "42", "a.ico", "42.ico/", "exe-.ico", "exe--a.ico", "exe-A.ico", "exe-a/b.ico", "exe-a.png", "", 42, null]) {
      expect(isIconFileName(bad)).toBe(false);
    }
  });

  it("allows a game only its Steam names and its own exe name", () => {
    const game = { id: "elden-ring", steamAppId: 5 };
    for (const file of ["5.ico", "5.jpg", "exe-elden-ring.ico"]) expect(iconFileAllowed(game, file)).toBe(true);
    for (const file of ["6.ico", "6.jpg", "exe-other.ico", "../5.ico", 5, null]) expect(iconFileAllowed(game, file)).toBe(false);
    expect(iconFileAllowed({ id: "mine", steamAppId: null }, "5.ico")).toBe(false);
    expect(iconFileAllowed({ id: "mine", steamAppId: null }, "exe-mine.ico")).toBe(true);
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
  const present = (...files: string[]) => async (file: string) => files.map((f) => path.win32.normalize(f)).includes(path.win32.normalize(file));

  it("takes the folder the Windows registry names, when Steam's cache is there", async () => {
    const found = await findSteamDir({
      platform: "win32",
      env: {},
      registry: async () => "c:/program files (x86)/steam",
      exists: present("c:/program files (x86)/steam/appcache/appinfo.vdf"),
    });
    expect(found).toBe(path.win32.normalize("c:/program files (x86)/steam"));
  });

  it("falls back to the usual folders, and to nothing", async () => {
    const options = { platform: "win32" as const, env: { "ProgramFiles(x86)": "D:\\Programs (x86)" }, registry: async () => null };
    expect(await findSteamDir({ ...options, exists: present("D:\\Programs (x86)\\Steam\\appcache\\appinfo.vdf") })).toBe(path.win32.normalize("D:\\Programs (x86)\\Steam"));
    expect(await findSteamDir({ ...options, exists: present() })).toBeNull();
  });

  it("ignores a registry folder that has no cache", async () => {
    const found = await findSteamDir({ platform: "win32", env: {}, registry: async () => "E:/gone", exists: present("C:\\Program Files (x86)\\Steam\\appcache\\appinfo.vdf") });
    expect(found).toBe(path.win32.normalize("C:\\Program Files (x86)\\Steam"));
  });

  it("looks in the usual places on Linux and macOS", async () => {
    expect(await findSteamDir({ platform: "linux", home: "/home/p", exists: present("/home/p/.local/share/Steam/appcache/appinfo.vdf") })).toBe(
      path.posix.normalize("/home/p/.local/share/Steam"),
    );
    expect(await findSteamDir({ platform: "darwin", home: "/Users/p", exists: present("/Users/p/Library/Application Support/Steam/appcache/appinfo.vdf") })).toBe(
      path.posix.normalize("/Users/p/Library/Application Support/Steam"),
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

/** A JPEG-looking file: the signature followed by filler. */
const JPEG = Uint8Array.from({ length: 700 }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xd8 : i === 2 ? 0xff : i % 251));

describe("saveExeIcon", () => {
  it("keeps an icon read from the game, unchanged, under the game's own name", async () => {
    await mkdir(icons, { recursive: true });
    expect(await saveExeIcon(icons, "diablo-iv", ICON)).toEqual({ status: "saved", file: "exe-diablo-iv.ico" });
    expect(new Uint8Array(await readFile(path.join(icons, "exe-diablo-iv.ico")))).toEqual(ICON);
  });

  it("refuses bytes that are not an icon and a game id that cannot be a file name", async () => {
    await mkdir(icons, { recursive: true });
    expect(await saveExeIcon(icons, "diablo-iv", new Uint8Array(200))).toEqual({ status: "none" });
    expect(await saveExeIcon(icons, "../escape", ICON)).toEqual({ status: "none" });
    expect(await readdir(icons)).toEqual([]);
  });
});

describe("fetchPublicIconHash", () => {
  const reply = (body: unknown, init: ResponseInit = {}) => answer(JSON.stringify(body), init);

  it("reads the icon hash of any app from Steam's public store API, with no key", async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ response: { apps: [{ appid: 2344520, icon: HASH }] } }));
    }) as unknown as typeof fetch;
    expect(await fetchPublicIconHash(2344520, { fetchImpl })).toEqual({ status: "found", hash: HASH });
    expect(asked).toEqual(["https://api.steampowered.com/ICommunityService/GetApps/v1?appids%5B0%5D=2344520"]);
  });

  it("says none for an unknown app, an app without a usable hash or a different app", async () => {
    expect(await fetchPublicIconHash(5, { fetchImpl: reply({ response: { apps: [] } }) })).toEqual({ status: "none" });
    expect(await fetchPublicIconHash(5, { fetchImpl: reply({ response: { apps: [{ appid: 5, icon: "../x" }] } }) })).toEqual({ status: "none" });
    expect(await fetchPublicIconHash(5, { fetchImpl: reply({ response: { apps: [{ appid: 6, icon: HASH }] } }) })).toEqual({ status: "none" });
    expect(await fetchPublicIconHash(5, { fetchImpl: reply("nonsense") })).toEqual({ status: "none" });
    expect(await fetchPublicIconHash(0)).toEqual({ status: "none" });
    expect(await fetchPublicIconHash(5, { fetchImpl: reply({}, { status: 404 }) })).toEqual({ status: "none" });
  });

  it("says failed when Steam or the network does not answer", async () => {
    expect(await fetchPublicIconHash(5, { fetchImpl: reply({}, { status: 503 }) })).toEqual({ status: "failed" });
    const offline = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await fetchPublicIconHash(5, { fetchImpl: offline })).toEqual({ status: "failed" });
  });
});

describe("savePublicSteamIcon", () => {
  it("downloads the small icon from Steam's address and keeps it unchanged", async () => {
    await mkdir(icons, { recursive: true });
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      return new Response(JPEG as BodyInit);
    }) as unknown as typeof fetch;
    expect(await savePublicSteamIcon(icons, 42, HASH, { fetchImpl })).toEqual({ status: "saved", file: "42.jpg" });
    expect(asked).toEqual([`https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/42/${HASH}.jpg`]);
    expect(new Uint8Array(await readFile(path.join(icons, "42.jpg")))).toEqual(JPEG);
  });

  it("refuses what is not a JPEG, a missing file and a bad hash, and reports a failing network", async () => {
    await mkdir(icons, { recursive: true });
    expect(await savePublicSteamIcon(icons, 42, HASH, { fetchImpl: answer("<html>nope</html>".repeat(20)) })).toEqual({ status: "none" });
    expect(await savePublicSteamIcon(icons, 42, HASH, { fetchImpl: answer("", { status: 404 }) })).toEqual({ status: "none" });
    expect(await savePublicSteamIcon(icons, 42, "nothash")).toEqual({ status: "none" });
    expect(await savePublicSteamIcon(icons, 42, HASH, { fetchImpl: answer("", { status: 500 }) })).toEqual({ status: "failed" });
    expect(await readdir(icons)).toEqual([]);
  });

  it("recognises a JPEG by its signature and size", () => {
    expect(isJpeg(JPEG)).toBe(true);
    expect(isJpeg(new Uint8Array(700))).toBe(false);
    expect(isJpeg(JPEG.slice(0, 50))).toBe(false);
  });
});

describe("needsIcon", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const game = (over: Partial<Parameters<typeof needsIcon>[0]> = {}) => ({ iconFile: null, iconCheckedAt: null, ...over });

  it("asks for a game that has no icon yet", () => expect(needsIcon(game(), now)).toBe(true));
  it("does not ask when it has the icon", () => {
    expect(needsIcon(game({ iconFile: "5.ico" }), now)).toBe(false);
    expect(needsIcon(game({ iconFile: "exe-mine.ico" }), now)).toBe(false);
  });
  it("asks again for a missing icon only after a week", () => {
    expect(needsIcon(game({ iconCheckedAt: "2026-10-10T00:00:00Z" }), now)).toBe(false);
    expect(needsIcon(game({ iconCheckedAt: "2026-10-01T00:00:00Z" }), now)).toBe(true);
    expect(needsIcon(game({ iconCheckedAt: "not a date" }), now)).toBe(true);
  });
});
