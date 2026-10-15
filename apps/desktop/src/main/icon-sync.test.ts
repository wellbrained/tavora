import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncIcons } from "./icon-sync";
import type { InstalledGame } from "./launcher-games";
import { addGame, emptyLibrary, trashGame, type Library } from "./library";
import { appInfo } from "./steam-appinfo.fixture";

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));
const hashOf = (digit: string) => digit.repeat(40);

/** A valid ICO file. */
const ICON = (() => {
  const bytes = new Uint8Array(6 + 16 + 30);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  view.setUint32(6 + 8, 30, true);
  view.setUint32(6 + 12, 22, true);
  return bytes;
})();

/** A JPEG-looking file. */
const JPEG = Uint8Array.from({ length: 300 }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xd8 : i === 2 ? 0xff : i % 251));

let dir: string;
let steam: string;
let icons: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-sync-"));
  steam = path.join(dir, "Steam");
  icons = path.join(dir, "steam-icons");
  await mkdir(path.join(steam, "steam", "games"), { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Steam's cache for these apps: elden-ring 1245620, factorio 427520, hades-2 1145350 (no icon hash). */
const cache = () =>
  appInfo(41, [
    { appid: 1245620, common: { name: "Elden Ring", clienticon: hashOf("a") } },
    { appid: 427520, common: { name: "Factorio", clienticon: hashOf("b") } },
    { appid: 1145350, common: { name: "Hades II" } },
  ]);

interface Net {
  /** Client icon files (`<hash>.ico`) by hash: a status, or "network" for no answer. */
  ico?: Record<string, number | "network">;
  /** The public store API: the icon hash of an appid, or null for none, or "network". */
  api?: Record<number, string | null | "network">;
  /** Small icons (`<hash>.jpg`) by hash. */
  jpg?: Record<string, number | "network">;
}

/** A fake Steam: answers by address and remembers what it was asked, in order. */
function fakeSteam(net: Net = {}) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    const api = /GetApps\/v1\?appids%5B0%5D=(\d+)$/.exec(url);
    if (api) {
      const appid = Number(api[1]);
      asked.push(`api:${appid}`);
      const hash = net.api?.[appid] ?? null;
      if (hash === "network") throw new Error("offline");
      return new Response(JSON.stringify({ response: { apps: hash ? [{ appid, icon: hash }] : [] } }));
    }
    const file = /\/([0-9a-f]{40})\.(ico|jpg)$/.exec(url)!;
    asked.push(`${file[2]}:${file[1]}`);
    const answer = (file[2] === "ico" ? net.ico : net.jpg)?.[file[1]!] ?? 404;
    if (answer === "network") throw new Error("offline");
    if (answer !== 200) return new Response("", { status: answer });
    return new Response((file[2] === "ico" ? ICON : JPEG) as BodyInit);
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

function libraryWith(...catalogIds: string[]): Library {
  const library = emptyLibrary();
  catalogIds.forEach((catalogId, index) => addGame(library, { catalogId }, day(1 + index)));
  return library;
}

const run = (library: Library, net: ReturnType<typeof fakeSteam>, extra: Partial<Parameters<typeof syncIcons>[0]> = {}) => {
  let changes = 0;
  const done = syncIcons({
    library,
    iconDir: icons,
    steamDir: steam,
    fetchImpl: net.fetchImpl,
    loadAppInfoImpl: async () => cache(),
    installedGames: async () => [],
    onChange: () => (changes += 1),
    pauseMs: 0,
    now: () => day(10),
    ...extra,
  });
  return { done, changes: () => changes };
};

describe("syncIcons: Steam", () => {
  it("copies icons Steam has on disk and downloads the ones it does not, unchanged", async () => {
    await writeFile(path.join(steam, "steam", "games", `${hashOf("a")}.ico`), ICON);
    const library = libraryWith("elden-ring", "factorio", "fortnite");
    const net = fakeSteam({ ico: { [hashOf("b")]: 200 } });
    const job = run(library, net);
    expect(await job.done).toBe(2);
    expect(net.asked).toEqual([`ico:${hashOf("b")}`]);
    expect(library.games["elden-ring"]!.iconFile).toBe("1245620.ico");
    expect(library.games.factorio!.iconFile).toBe("427520.ico");
    // Fortnite has no Steam id and is not installed: noted, with nothing asked.
    expect(library.games.fortnite).toMatchObject({ iconFile: null, steamAppId: null, iconCheckedAt: day(10).toISOString() });
    expect((await readdir(icons)).sort()).toEqual(["1245620.ico", "427520.ico"]);
    expect(job.changes()).toBe(3);
  });

  it("uses Steam's small public icon when the client has none, and does not look again soon after a miss", async () => {
    const library = libraryWith("hades-2");
    const net = fakeSteam({ api: { 1145350: hashOf("c") }, jpg: { [hashOf("c")]: 200 } });
    expect(await run(library, net).done).toBe(1);
    expect(net.asked).toEqual(["api:1145350", `jpg:${hashOf("c")}`]);
    expect(library.games["hades-2"]!.iconFile).toBe("1145350.jpg");

    const missing = libraryWith("hades-2");
    const none = fakeSteam({});
    expect(await run(missing, none).done).toBe(0);
    expect(missing.games["hades-2"]).toMatchObject({ iconFile: null, iconCheckedAt: day(10).toISOString() });
    const again = fakeSteam({});
    await run(missing, again).done;
    expect(again.asked).toEqual([]);
    // A week later it looks again.
    await run(missing, again, { now: () => day(20) }).done;
    expect(again.asked).toEqual(["api:1145350"]);
    expect(missing.games["hades-2"]!.iconCheckedAt).toBe(day(20).toISOString());
  });

  it("falls back to the small public icon when Steam's address does not have the client icon", async () => {
    const library = libraryWith("elden-ring");
    const net = fakeSteam({ api: { 1245620: hashOf("d") }, jpg: { [hashOf("d")]: 200 } });
    expect(await run(library, net).done).toBe(1);
    expect(net.asked).toEqual([`ico:${hashOf("a")}`, "api:1245620", `jpg:${hashOf("d")}`]);
    expect(library.games["elden-ring"]!.iconFile).toBe("1245620.jpg");
  });

  it("notes a game that no source has an icon for", async () => {
    const library = libraryWith("elden-ring");
    expect(await run(library, fakeSteam({})).done).toBe(0);
    expect(library.games["elden-ring"]).toMatchObject({ iconFile: null, iconCheckedAt: day(10).toISOString() });
  });

  it("still finds the small public icon when Steam is not installed or its cache cannot be read", async () => {
    const net = () => fakeSteam({ api: { 1245620: hashOf("d") }, jpg: { [hashOf("d")]: 200 } });
    for (const extra of [{ steamDir: null }, { loadAppInfoImpl: async () => null }, { loadAppInfoImpl: async () => new Uint8Array(64) }]) {
      const library = libraryWith("elden-ring");
      const steamless = net();
      expect(await run(library, steamless, extra).done).toBe(1);
      expect(steamless.asked).toEqual(["api:1245620", `jpg:${hashOf("d")}`]);
      await rm(icons, { recursive: true, force: true });
    }
  });

  it("stops when the network does not answer, and leaves the game for next time", async () => {
    const library = libraryWith("elden-ring", "factorio");
    const net = fakeSteam({ ico: { [hashOf("a")]: "network", [hashOf("b")]: 200 } });
    const job = run(library, net);
    expect(await job.done).toBe(0);
    expect(net.asked).toEqual([`ico:${hashOf("a")}`]);
    expect(library.games["elden-ring"]).toMatchObject({ iconFile: null, iconCheckedAt: null });
    expect(job.changes()).toBe(0);
    expect(await run(library, fakeSteam({ ico: { [hashOf("a")]: 200, [hashOf("b")]: 200 } })).done).toBe(2);
  });

  it("stops when Steam's public API does not answer", async () => {
    const library = libraryWith("hades-2");
    const net = fakeSteam({ api: { 1145350: "network" } });
    expect(await run(library, net).done).toBe(0);
    expect(library.games["hades-2"]).toMatchObject({ iconFile: null, iconCheckedAt: null });
  });
});

describe("syncIcons: the installed game", () => {
  const installed = (...games: Array<Partial<InstalledGame> & { name: string }>): InstalledGame[] =>
    games.map((game) => ({ source: "windows", file: "C:\\Games\\a.exe", index: 0, ...game }));

  it("takes the icon from the installed game first, with nothing asked of Steam", async () => {
    const library = libraryWith("elden-ring");
    addGame(library, { name: "Diablo IV" }, day(5));
    const net = fakeSteam({});
    const read: Array<[string, number]> = [];
    const job = run(library, net, {
      installedGames: async () => installed({ name: "Elden Ring", file: "C:\\Games\\er.exe" }, { name: "Diablo® IV", file: "G:\\D4\\d4.exe", index: 2 }),
      readIcon: async (file, index) => (read.push([file, index]), ICON),
    });
    expect(await job.done).toBe(2);
    expect(net.asked).toEqual([]);
    expect(read).toEqual([
      ["C:\\Games\\er.exe", 0],
      ["G:\\D4\\d4.exe", 2],
    ]);
    // A game with a Steam id keeps its place on the Steam name only when the file is the game's own.
    expect(library.games["elden-ring"]!.iconFile).toBe("exe-elden-ring.ico");
    expect(library.games["local-diablo-iv"]!.iconFile).toBe("exe-local-diablo-iv.ico");
    expect((await readdir(icons)).sort()).toEqual(["exe-elden-ring.ico", "exe-local-diablo-iv.ico"]);
  });

  it("prefers Battle.net when two launchers know the same game", async () => {
    const library = emptyLibrary();
    addGame(library, { name: "StarCraft II" }, day(1));
    const read: string[] = [];
    await run(library, fakeSteam({}), {
      installedGames: async () =>
        installed({ name: "StarCraft II", file: "D:\\other.exe" }, { name: "StarCraft II", source: "battlenet", file: "G:\\sc2.exe" }),
      readIcon: async (file) => (read.push(file), ICON),
    }).done;
    expect(read).toEqual(["G:\\sc2.exe"]);
  });

  it("goes on to Steam when the program has no usable icon, and when the launcher scan fails", async () => {
    const library = libraryWith("elden-ring");
    const net = fakeSteam({ ico: { [hashOf("a")]: 200 } });
    const job = run(library, net, {
      installedGames: async () => installed({ name: "Elden Ring" }),
      readIcon: async () => new Uint8Array(40),
    });
    expect(await job.done).toBe(1);
    expect(library.games["elden-ring"]!.iconFile).toBe("1245620.ico");

    const other = libraryWith("elden-ring");
    expect(
      await run(other, fakeSteam({ ico: { [hashOf("a")]: 200 } }), {
        installedGames: async () => {
          throw new Error("no registry");
        },
      }).done,
    ).toBe(1);
    const unreadable = libraryWith("elden-ring");
    expect(
      await run(unreadable, fakeSteam({ ico: { [hashOf("a")]: 200 } }), {
        installedGames: async () => installed({ name: "Elden Ring" }),
        readIcon: async () => {
          throw new Error("locked");
        },
      }).done,
    ).toBe(1);
  });

  it("looks at the launchers once per run, and not at all when every game has its icon", async () => {
    const library = libraryWith("elden-ring", "factorio");
    let scans = 0;
    await run(library, fakeSteam({ ico: { [hashOf("a")]: 200, [hashOf("b")]: 200 } }), {
      installedGames: async () => (scans += 1, []),
    }).done;
    expect(scans).toBe(1);
    await run(library, fakeSteam({}), { installedGames: async () => (scans += 1, []) }).done;
    expect(scans).toBe(1);
  });
});

describe("syncIcons: housekeeping", () => {
  it("asks for nothing when the setting is off, and stops when told to", async () => {
    const library = libraryWith("elden-ring", "factorio");
    const net = fakeSteam({ ico: { [hashOf("a")]: 200, [hashOf("b")]: 200 } });
    library.steamIcons = false;
    expect(await run(library, net).done).toBe(0);
    expect(net.asked).toEqual([]);
    library.steamIcons = true;
    let allowed = true;
    const job = run(library, net, { shouldRun: () => allowed, onChange: () => (allowed = false) });
    expect(await job.done).toBe(1);
  });

  it("does not ask for games in Trash, or for ones that already have their icon", async () => {
    const library = libraryWith("elden-ring", "factorio");
    trashGame(library, "factorio", day(2));
    library.games["elden-ring"]!.iconFile = "1245620.ico";
    const net = fakeSteam({ ico: { [hashOf("a")]: 200, [hashOf("b")]: 200 } });
    expect(await run(library, net).done).toBe(0);
    expect(net.asked).toEqual([]);
  });

  it("removes an icon that arrives for a game deleted in the meantime", async () => {
    const library = libraryWith("elden-ring");
    const fetchImpl = (async () => {
      delete library.games["elden-ring"];
      return new Response(ICON as BodyInit);
    }) as unknown as typeof fetch;
    expect(await run(library, { fetchImpl, asked: [] }).done).toBe(0);
    expect(await readdir(icons)).toEqual([]);
  });

  it("removes an icon read from a game that was deleted in the meantime", async () => {
    const library = emptyLibrary();
    addGame(library, { name: "Diablo IV" }, day(1));
    await run(library, fakeSteam({}), {
      installedGames: async () => [{ source: "battlenet", name: "Diablo IV", file: "G:\\d4.exe", index: 0 }],
      readIcon: async () => (delete library.games["local-diablo-iv"], ICON),
    }).done;
    expect(await readdir(icons)).toEqual([]);
  });
});
