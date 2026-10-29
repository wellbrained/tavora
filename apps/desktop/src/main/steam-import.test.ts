import { describe, expect, it } from "vitest";
import { addWorkspace, emptyLibrary, trashWorkspace } from "./library";
import { fetchSteamLibrary, importSteamGames, parseSteamGame, steamGameStatus } from "./steam-import";

const day = new Date("2026-10-15T10:00:00Z");
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("parseSteamGame", () => {
  it("keeps a good game and drops a local id", () => {
    expect(parseSteamGame({ appid: 1245620, name: " Elden Ring ", id: "elden-ring", extra: 1 })).toEqual({ appid: 1245620, name: "Elden Ring", id: "elden-ring" });
    expect(parseSteamGame({ appid: 5, name: "X", id: "local-x" })).toEqual({ appid: 5, name: "X", id: null });
    expect(parseSteamGame({ appid: 5, name: "X", id: null })).toEqual({ appid: 5, name: "X", id: null });
  });

  it.each([[null], [{ appid: 0, name: "X" }], [{ appid: "5", name: "X" }], [{ appid: 5, name: "  " }], [{ appid: 5, name: "n".repeat(301) }], [{ appid: 5 }]])(
    "drops %j",
    (raw) => expect(parseSteamGame(raw)).toBeNull(),
  );
});

describe("steamGameStatus", () => {
  it("finds a game by id, by appid and by name, and tells Trash apart", () => {
    const library = emptyLibrary();
    addWorkspace(library, { online: { id: "elden-ring", name: "Elden Ring", steamAppId: 1245620 } }, day);
    addWorkspace(library, { name: "Portal 2" }, day);
    const hades = addWorkspace(library, { name: "Hades", steamAppId: 1145360 }, day);
    expect(steamGameStatus(library, { appid: 1245620, name: "Elden Ring", id: "elden-ring" })).toBe("owned");
    expect(steamGameStatus(library, { appid: 1, name: "Whatever", id: "elden-ring" })).toBe("owned");
    expect(steamGameStatus(library, { appid: 620, name: "Portal® 2", id: null })).toBe("owned");
    expect(steamGameStatus(library, { appid: 1145360, name: "Hades (Steam)", id: null })).toBe("owned");
    expect(steamGameStatus(library, { appid: 7, name: "Celeste", id: "celeste" })).toBe("new");
    trashWorkspace(library, hades, day);
    expect(steamGameStatus(library, { appid: 1145360, name: "Hades", id: null })).toBe("trash");
  });
});

describe("importSteamGames", () => {
  it("adds new games with their appid, skips owned ones and never adds twice", () => {
    const library = emptyLibrary();
    addWorkspace(library, { name: "Portal 2" }, day);
    const games = [
      { appid: 1245620, name: "Elden Ring", id: "elden-ring" },
      { appid: 620, name: "Portal 2", id: null },
      { appid: 999, name: "Obscure Game", id: null },
      { appid: 1245620, name: "Elden Ring", id: "elden-ring" },
    ];
    const added = importSteamGames(library, games, day);
    expect(added).toHaveLength(2);
    expect(library.workspaces["elden-ring"]).toMatchObject({ name: "Elden Ring", steamAppId: 1245620 });
    const custom = library.workspaces[added[1]!]!;
    expect(custom).toMatchObject({ name: "Obscure Game", steamAppId: 999, catalogId: null });
    expect(custom.id.startsWith("local-")).toBe(true);
    expect(importSteamGames(library, games, day)).toEqual([]);
  });
});

describe("fetchSteamLibrary", () => {
  const options = (fetchImpl: typeof fetch) => ({ baseUrl: "https://api.example/", fetchImpl });

  it("posts only the profile and returns valid games", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return answer({ games: [{ appid: 1, name: "A", id: "a" }, { appid: 0, name: "bad" }] });
    }) as unknown as typeof fetch;
    const result = await fetchSteamLibrary(options(fetchImpl), "  https://steamcommunity.com/id/me  ");
    expect(result).toEqual({ status: "ok", games: [{ appid: 1, name: "A", id: "a" }] });
    expect(requests[0]!.url).toBe("https://api.example/v1/steam/library");
    expect(requests[0]!.init).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer" });
    expect(JSON.parse(requests[0]!.init.body as string)).toEqual({ profile: "https://steamcommunity.com/id/me" });
  });

  it("passes the service's message for a refusal and words the other failures", async () => {
    const refuse = (status: number, body: unknown) => fetchSteamLibrary(options((async () => answer(body, status)) as unknown as typeof fetch), "x");
    expect(await refuse(404, { error: "Steam has no profile with that name." })).toEqual({ status: "error", error: "Steam has no profile with that name." });
    expect(await refuse(429, { error: "Too many requests." })).toMatchObject({ status: "error", error: expect.stringContaining("wait") });
    expect(await refuse(503, "nope")).toMatchObject({ status: "error", error: expect.stringContaining("isn't working right now") });
    expect(await refuse(200, { games: "no" })).toMatchObject({ status: "error" });
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchSteamLibrary(options(down), "x")).toMatchObject({ status: "error", error: expect.stringContaining("reach") });
  });

  it("words a reason code from the service in the user's language, and falls back for one it does not know", async () => {
    const refuse = (language: "en" | "de", status: number, body: unknown) =>
      fetchSteamLibrary({ ...options((async () => answer(body, status)) as unknown as typeof fetch), language }, "x");
    expect(await refuse("de", 404, { error: "Steam has no profile with that name.", code: "no-such-profile" })).toEqual({
      status: "error",
      error: "Steam findet dieses Profil nicht. Prüf den Link und versuch es noch mal.",
    });
    expect(await refuse("en", 502, { error: "Steam did not return a game list.", code: "no-game-list" })).toMatchObject({ error: expect.stringContaining("Public") });
    // Newer services name it `reason`, as every other API answer does.
    expect(await refuse("en", 502, { error: "Steam did not return a game list.", reason: "no-game-list" })).toMatchObject({ error: expect.stringContaining("Public") });
    expect(await refuse("de", 429, { error: "Too many requests.", code: "too-many" })).toMatchObject({ error: expect.stringContaining("Zu viele") });
    expect(await refuse("de", 400, { error: "English text", code: "made-up-later" })).toEqual({
      status: "error",
      error: "Der Steam-Import klappt gerade nicht. Versuch es gleich noch mal.",
    });
    expect(await refuse("en", 400, { error: "English text", code: "constructor" })).toEqual({
      status: "error",
      error: "Can't import from Steam right now. Try again in a bit.",
    });
    // A service without codes (an older one) still shows its own text.
    expect(await refuse("de", 400, { error: "Enter a steamcommunity.com profile link." })).toEqual({ status: "error", error: "Enter a steamcommunity.com profile link." });
  });

  it("does not call the service for an empty or huge profile", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return answer({ games: [] });
    }) as unknown as typeof fetch;
    expect((await fetchSteamLibrary(options(fetchImpl), "   ")).status).toBe("error");
    expect((await fetchSteamLibrary(options(fetchImpl), "x".repeat(201))).status).toBe("error");
    expect(calls).toBe(0);
  });
});
