import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncArt } from "./art-sync";
import { addGame, emptyLibrary, trashGame, type Library } from "./library";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-sync-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A fake Steam: answers by appid and remembers what it was asked, in order. */
function fakeSteam(byAppid: Record<number, number | "network">) {
  const asked: number[] = [];
  const fetchImpl = (async (url: string) => {
    const appid = Number(/apps\/(\d+)\//.exec(url)![1]);
    asked.push(appid);
    const answer = byAppid[appid] ?? 404;
    if (answer === "network") throw new Error("offline");
    return answer === 200 ? new Response(JPEG) : new Response("", { status: answer });
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

function libraryWith(...catalogIds: string[]): Library {
  const library = emptyLibrary();
  catalogIds.forEach((catalogId, index) => addGame(library, { catalogId }, day(1 + index)));
  return library;
}

const run = (library: Library, fetchImpl: typeof fetch, extra: Partial<Parameters<typeof syncArt>[0]> = {}) => {
  let changes = 0;
  const done = syncArt({ library, artDir: dir, fetchImpl, onChange: () => (changes += 1), pauseMs: 0, now: () => day(10), ...extra });
  return { done, changes: () => changes };
};

describe("syncArt", () => {
  it("fetches covers for games with a Steam id, one at a time, and keeps the files", async () => {
    const library = libraryWith("elden-ring", "factorio", "fortnite");
    const steam = fakeSteam({ 1245620: 200, 427520: 200 });
    const job = run(library, steam.fetchImpl);
    expect(await job.done).toBe(2);
    expect(steam.asked).toEqual([1245620, 427520]);
    expect(library.games["elden-ring"]!.artFile).toBe("1245620.jpg");
    expect(library.games.factorio!.artFile).toBe("427520.jpg");
    expect(library.games.fortnite).toMatchObject({ artFile: null, steamAppId: null });
    expect((await readdir(dir)).sort()).toEqual(["1245620.jpg", "427520.jpg"]);
    expect(job.changes()).toBe(2);
  });

  it("notes a game Steam has no cover for, and does not ask again", async () => {
    const library = libraryWith("elden-ring");
    const steam = fakeSteam({});
    expect(await run(library, steam.fetchImpl).done).toBe(0);
    expect(library.games["elden-ring"]).toMatchObject({ artFile: null, artCheckedAt: day(10).toISOString() });
    expect(await run(library, steam.fetchImpl).done).toBe(0);
    expect(steam.asked).toEqual([1245620]);
  });

  it("stops when Steam or the network does not answer, and leaves the game for next time", async () => {
    const library = libraryWith("elden-ring", "factorio");
    const steam = fakeSteam({ 1245620: "network", 427520: 200 });
    const job = run(library, steam.fetchImpl);
    expect(await job.done).toBe(0);
    expect(steam.asked).toEqual([1245620]);
    expect(library.games["elden-ring"]).toMatchObject({ artFile: null, artCheckedAt: null });
    expect(job.changes()).toBe(0);
    // Next time it works.
    expect(await run(library, fakeSteam({ 1245620: 200, 427520: 200 }).fetchImpl).done).toBe(2);
  });

  it("asks for nothing when fetching is off", async () => {
    const library = libraryWith("elden-ring");
    library.steamIcons = false;
    const steam = fakeSteam({ 1245620: 200 });
    expect(await run(library, steam.fetchImpl).done).toBe(0);
    expect(steam.asked).toEqual([]);
  });

  it("stops when told to, even between games", async () => {
    const library = libraryWith("elden-ring", "factorio");
    const steam = fakeSteam({ 1245620: 200, 427520: 200 });
    let allowed = true;
    const job = run(library, steam.fetchImpl, { shouldRun: () => allowed, onChange: () => (allowed = false) });
    expect(await job.done).toBe(1);
    expect(steam.asked).toEqual([1245620]);
  });

  it("does not ask for games in Trash, or for ones that already have their cover", async () => {
    const library = libraryWith("elden-ring", "factorio");
    trashGame(library, "factorio", day(2));
    library.games["elden-ring"]!.artFile = "1245620.jpg";
    const steam = fakeSteam({ 1245620: 200, 427520: 200 });
    expect(await run(library, steam.fetchImpl).done).toBe(0);
    expect(steam.asked).toEqual([]);
  });

  it("removes a cover that arrives for a game deleted in the meantime", async () => {
    const library = libraryWith("elden-ring");
    const fetchImpl = (async () => {
      delete library.games["elden-ring"];
      return new Response(JPEG);
    }) as unknown as typeof fetch;
    expect(await run(library, fetchImpl).done).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it("uses the address it is given instead of Steam's", async () => {
    const library = libraryWith("elden-ring");
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => (urls.push(url), new Response(JPEG))) as unknown as typeof fetch;
    await run(library, fetchImpl, { baseUrl: "http://127.0.0.1:9/art" }).done;
    expect(urls).toEqual(["http://127.0.0.1:9/art/1245620/library_600x900.jpg"]);
  });
});
