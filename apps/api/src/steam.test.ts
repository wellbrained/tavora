import { describe, expect, it } from "vitest";
import { SteamError, createSteamClient, parseProfile } from "./steam.ts";

const ID = "76561197960287930";

describe("parseProfile", () => {
  it("takes a SteamID64", () => expect(parseProfile(` ${ID} `)).toEqual({ kind: "id", id: ID }));

  it.each([
    [`https://steamcommunity.com/profiles/${ID}`, { kind: "id", id: ID }],
    [`https://steamcommunity.com/profiles/${ID}/`, { kind: "id", id: ID }],
    [`http://www.steamcommunity.com/profiles/${ID}`, { kind: "id", id: ID }],
    ["https://steamcommunity.com/id/some_user-1", { kind: "vanity", name: "some_user-1" }],
    ["https://steamcommunity.com/id/some_user-1/", { kind: "vanity", name: "some_user-1" }],
  ])("reads %s", (input, expected) => expect(parseProfile(input)).toEqual(expected));

  it.each([
    "",
    "hello",
    "12345",
    "https://example.com/id/someone",
    "https://steamcommunity.com.evil.test/id/someone",
    "https://steamcommunity.com/id/",
    "https://steamcommunity.com/id/a",
    "https://steamcommunity.com/id/has space",
    "https://steamcommunity.com/profiles/123",
    "https://steamcommunity.com/id/someone/games",
    "ftp://steamcommunity.com/id/someone",
    "javascript:alert(1)",
  ])("refuses %j", (input) => {
    expect(() => parseProfile(input)).toThrow(SteamError);
  });

  it.each([
    ["hello", "bad-link"],
    ["https://example.com/id/someone", "not-steam-link"],
    ["https://steamcommunity.com/id/someone/games", "not-steam-link"],
    ["https://steamcommunity.com/profiles/123", "bad-id"],
    ["https://steamcommunity.com/id/a", "bad-name"],
  ])("gives %j the reason %s", (input, code) => {
    expect(() => parseProfile(input)).toThrow(expect.objectContaining({ status: 400, code }));
  });
});

/** A fake Steam: answers by the method in the URL and remembers what it was asked. */
function fakeSteam(answers: Record<string, unknown>) {
  const calls: { url: string; key: string | null }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, key: new Headers(init?.headers).get("x-webapi-key") });
    const method = Object.keys(answers).find((name) => url.includes(name));
    if (!method) return new Response("not found", { status: 404 });
    const answer = answers[method];
    return answer instanceof Response ? answer : Response.json(answer);
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("createSteamClient", () => {
  const owned = (games: unknown, count = Array.isArray(games) ? games.length : 0) => ({
    "IPlayerService/GetOwnedGames": { response: { game_count: count, games } },
  });

  it("returns owned games sorted by name, once per appid, and sends the key only as a header", async () => {
    const { fetcher, calls } = fakeSteam(
      owned([
        { appid: 2, name: "Zeta" },
        { appid: 1, name: "Alpha" },
        { appid: 2, name: "Zeta again" },
        { appid: 3, name: "   " },
        { appid: -4, name: "Negative" },
      ]),
    );
    const client = createSteamClient({ key: "secret-key", fetch: fetcher });
    expect(await client.ownedGames(ID)).toEqual([
      { appid: 1, name: "Alpha" },
      { appid: 2, name: "Zeta" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe("secret-key");
    expect(calls[0]!.url).not.toContain("secret-key");
    expect(calls[0]!.url).toContain(`steamid=${ID}`);
  });

  it("resolves a custom profile name first", async () => {
    const { fetcher, calls } = fakeSteam({
      "ISteamUser/ResolveVanityURL": { response: { success: 1, steamid: ID } },
      ...owned([{ appid: 5, name: "Game" }]),
    });
    const client = createSteamClient({ key: "k", fetch: fetcher });
    expect(await client.ownedGames("https://steamcommunity.com/id/some_user")).toEqual([{ appid: 5, name: "Game" }]);
    expect(calls.map((call) => call.url.split("/")[3] + "/" + call.url.split("/")[4])).toEqual([
      "ISteamUser/ResolveVanityURL",
      "IPlayerService/GetOwnedGames",
    ]);
  });

  it("answers 404 for a custom name Steam does not know", async () => {
    const { fetcher } = fakeSteam({ "ISteamUser/ResolveVanityURL": { response: { success: 42 } } });
    await expect(createSteamClient({ key: "k", fetch: fetcher }).ownedGames("https://steamcommunity.com/id/nobody")).rejects.toMatchObject({
      status: 404,
      code: "no-such-profile",
    });
  });

  it("treats an empty answer as a private profile, but a real zero as an empty library", async () => {
    const privateProfile = fakeSteam({ "IPlayerService/GetOwnedGames": { response: {} } });
    await expect(createSteamClient({ key: "k", fetch: privateProfile.fetcher }).ownedGames(ID)).rejects.toMatchObject({
      status: 502,
      code: "no-game-list",
      message: expect.stringContaining("Game details"),
    });
    const empty = fakeSteam({ "IPlayerService/GetOwnedGames": { response: { game_count: 0 } } });
    expect(await createSteamClient({ key: "k", fetch: empty.fetcher }).ownedGames(ID)).toEqual([]);
    const missingList = fakeSteam({ "IPlayerService/GetOwnedGames": { response: { game_count: 3 } } });
    await expect(createSteamClient({ key: "k", fetch: missingList.fetcher }).ownedGames(ID)).rejects.toMatchObject({ status: 502, code: "no-game-list" });
  });

  it("answers 502 when Steam fails, times out or sends junk, without leaking the key", async () => {
    const down = createSteamClient({ key: "secret-key", fetch: (async () => Response.json({}, { status: 500 })) as typeof fetch });
    await expect(down.ownedGames(ID)).rejects.toMatchObject({ status: 502, code: "steam-unreachable" });
    const broken = createSteamClient({ key: "secret-key", fetch: (async () => { throw new Error("connect failed for secret-key"); }) as typeof fetch });
    const error = (await broken.ownedGames(ID).catch((caught: unknown) => caught)) as SteamError;
    expect(error).toBeInstanceOf(SteamError);
    expect(error.code).toBe("steam-unreachable");
    expect(error.message).not.toContain("secret-key");
    const junk = createSteamClient({ key: "k", fetch: (async () => new Response("<html>", { status: 200 })) as typeof fetch });
    await expect(junk.ownedGames(ID)).rejects.toMatchObject({ status: 502, code: "steam-unreadable" });
  });
});
