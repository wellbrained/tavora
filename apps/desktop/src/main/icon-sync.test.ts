import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncIcons } from "./icon-sync";
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

/** A fake icon address: answers by hash and remembers what it was asked, in order. */
function fakeCdn(byHash: Record<string, number | "network">) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string) => {
    const hash = /\/([0-9a-f]{40})\.ico$/.exec(url)![1]!;
    asked.push(hash);
    const answer = byHash[hash] ?? 404;
    if (answer === "network") throw new Error("offline");
    return answer === 200 ? new Response(ICON as BodyInit) : new Response("", { status: answer });
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

function libraryWith(...catalogIds: string[]): Library {
  const library = emptyLibrary();
  catalogIds.forEach((catalogId, index) => addGame(library, { catalogId }, day(1 + index)));
  return library;
}

const run = (library: Library, cdn: ReturnType<typeof fakeCdn>, extra: Partial<Parameters<typeof syncIcons>[0]> = {}) => {
  let changes = 0;
  const done = syncIcons({
    library,
    iconDir: icons,
    steamDir: steam,
    fetchImpl: cdn.fetchImpl,
    loadAppInfoImpl: async () => cache(),
    onChange: () => (changes += 1),
    pauseMs: 0,
    now: () => day(10),
    ...extra,
  });
  return { done, changes: () => changes };
};

describe("syncIcons", () => {
  it("copies icons Steam has on disk and downloads the ones it does not, unchanged", async () => {
    await writeFile(path.join(steam, "steam", "games", `${hashOf("a")}.ico`), ICON);
    const library = libraryWith("elden-ring", "factorio", "fortnite");
    const cdn = fakeCdn({ [hashOf("b")]: 200 });
    const job = run(library, cdn);
    expect(await job.done).toBe(2);
    expect(cdn.asked).toEqual([hashOf("b")]);
    expect(library.games["elden-ring"]!.iconFile).toBe("1245620.ico");
    expect(library.games.factorio!.iconFile).toBe("427520.ico");
    expect(library.games.fortnite).toMatchObject({ iconFile: null, steamAppId: null });
    expect((await readdir(icons)).sort()).toEqual(["1245620.ico", "427520.ico"]);
    expect(job.changes()).toBe(2);
  });

  it("notes a game Steam's cache has no icon for, without asking the network, and not again soon", async () => {
    const library = libraryWith("hades-2");
    const cdn = fakeCdn({});
    expect(await run(library, cdn).done).toBe(0);
    expect(cdn.asked).toEqual([]);
    expect(library.games["hades-2"]).toMatchObject({ iconFile: null, iconCheckedAt: day(10).toISOString() });
    let reads = 0;
    expect(await run(library, cdn, { loadAppInfoImpl: async () => (reads += 1, cache()) }).done).toBe(0);
    expect(library.games["hades-2"]!.iconCheckedAt).toBe(day(10).toISOString());
    // A week later it looks again.
    await run(library, cdn, { now: () => day(20) }).done;
    expect(library.games["hades-2"]!.iconCheckedAt).toBe(day(20).toISOString());
  });

  it("notes a game whose icon Steam's address does not have", async () => {
    const library = libraryWith("elden-ring");
    expect(await run(library, fakeCdn({})).done).toBe(0);
    expect(library.games["elden-ring"]).toMatchObject({ iconFile: null, iconCheckedAt: day(10).toISOString() });
  });

  it("does nothing, and marks nothing, when Steam is not installed or its cache cannot be read", async () => {
    const library = libraryWith("elden-ring");
    const cdn = fakeCdn({ [hashOf("a")]: 200 });
    expect(await run(library, cdn, { steamDir: null }).done).toBe(0);
    expect(await run(library, cdn, { loadAppInfoImpl: async () => null }).done).toBe(0);
    expect(await run(library, cdn, { loadAppInfoImpl: async () => new Uint8Array(64) }).done).toBe(0);
    expect(cdn.asked).toEqual([]);
    expect(library.games["elden-ring"]).toMatchObject({ iconFile: null, iconCheckedAt: null });
  });

  it("stops when the network does not answer, and leaves the game for next time", async () => {
    const library = libraryWith("elden-ring", "factorio");
    const cdn = fakeCdn({ [hashOf("a")]: "network", [hashOf("b")]: 200 });
    const job = run(library, cdn);
    expect(await job.done).toBe(0);
    expect(cdn.asked).toEqual([hashOf("a")]);
    expect(library.games["elden-ring"]).toMatchObject({ iconFile: null, iconCheckedAt: null });
    expect(job.changes()).toBe(0);
    expect(await run(library, fakeCdn({ [hashOf("a")]: 200, [hashOf("b")]: 200 })).done).toBe(2);
  });

  it("asks for nothing when the setting is off, and stops when told to", async () => {
    const library = libraryWith("elden-ring", "factorio");
    const cdn = fakeCdn({ [hashOf("a")]: 200, [hashOf("b")]: 200 });
    library.steamIcons = false;
    expect(await run(library, cdn).done).toBe(0);
    expect(cdn.asked).toEqual([]);
    library.steamIcons = true;
    let allowed = true;
    const job = run(library, cdn, { shouldRun: () => allowed, onChange: () => (allowed = false) });
    expect(await job.done).toBe(1);
  });

  it("does not ask for games in Trash, or for ones that already have their icon", async () => {
    const library = libraryWith("elden-ring", "factorio");
    trashGame(library, "factorio", day(2));
    library.games["elden-ring"]!.iconFile = "1245620.ico";
    const cdn = fakeCdn({ [hashOf("a")]: 200, [hashOf("b")]: 200 });
    expect(await run(library, cdn).done).toBe(0);
    expect(cdn.asked).toEqual([]);
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
});
