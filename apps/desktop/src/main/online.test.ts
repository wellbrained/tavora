import { describe, expect, it } from "vitest";
import { OnlineSearch, parseOnlineGame } from "./online";

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("parseOnlineGame", () => {
  it("accepts a game and trims its name, ignoring other fields", () => {
    expect(parseOnlineGame({ id: "hollow-knight", name: " Hollow Knight ", extra: 1 })).toEqual({
      id: "hollow-knight",
      name: "Hollow Knight",
      steamAppId: null,
    });
  });

  it("keeps a valid Steam appid and treats a bad one as none", () => {
    expect(parseOnlineGame({ id: "elden-ring", name: "Elden Ring", steamAppId: 1245620 })).toMatchObject({ steamAppId: 1245620 });
    for (const bad of [0, -3, 1.5, "1245620", null, 3_000_000_000]) {
      expect(parseOnlineGame({ id: "elden-ring", name: "Elden Ring", steamAppId: bad })).toMatchObject({ steamAppId: null });
    }
  });

  it.each([
    [null],
    ["x"],
    [{ id: "../x", name: "X" }],
    [{ id: "Has Caps", name: "X" }],
    [{ id: "x".repeat(81), name: "X" }],
    [{ id: "x", name: "   " }],
    [{ id: "x", name: "n".repeat(201) }],
    [{ id: 7, name: "X" }],
    [{ id: "x" }],
  ])("drops %j", (raw) => {
    expect(parseOnlineGame(raw)).toBeNull();
  });
});

describe("OnlineSearch", () => {
  it("asks the service with only the typed text and returns valid games", async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return answer({
        results: [
          { id: "hollow-knight", name: "Hollow Knight", steamAppId: 1145360 },
          { id: "../bad", name: "Bad" },
        ],
      });
    }) as unknown as typeof fetch;
    const search = new OnlineSearch({ baseUrl: "https://service.test/", fetchImpl });

    expect(await search.search("  hollow   kn ")).toEqual({
      status: "ok",
      games: [{ id: "hollow-knight", name: "Hollow Knight", steamAppId: 1145360 }],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://service.test/v1/games/search?q=hollow%20kn&limit=20");
    expect(requests[0]!.init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" });
    expect(Object.keys(requests[0]!.init.headers as object)).toEqual(["Accept"]);
  });

  it("also reads the service's older reply, a bare list", async () => {
    const fetchImpl = (async () => answer([{ id: "hollow", name: "Hollow" }])) as unknown as typeof fetch;
    expect(await new OnlineSearch({ fetchImpl }).search("hollow")).toEqual({ status: "ok", games: [{ id: "hollow", name: "Hollow", steamAppId: null }] });
  });

  it("treats an answer of an unexpected shape as no games", async () => {
    const fetchImpl = (async () => answer({ unexpected: true })) as unknown as typeof fetch;
    expect(await new OnlineSearch({ fetchImpl }).search("hollow")).toEqual({ status: "ok", games: [] });
  });

  it("sends nothing for text that is too short", async () => {
    let calls = 0;
    const fetchImpl = (async () => (calls++, answer({ results: [] }))) as unknown as typeof fetch;
    const search = new OnlineSearch({ fetchImpl });
    expect(await search.search("a")).toEqual({ status: "ok", games: [] });
    expect(await search.search("  ")).toEqual({ status: "ok", games: [] });
    expect(calls).toBe(0);
  });

  it.each([
    ["an error answer", async () => answer({ error: "rate_limited" }, 429)],
    ["a network failure", async () => Promise.reject(new TypeError("fetch failed"))],
    ["an answer that is not JSON", async () => new Response("<html>", { status: 200 })],
  ])("reports unreachable on %s, never throws", async (_name, fetchImpl) => {
    const search = new OnlineSearch({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await search.search("elden")).toEqual({ status: "unreachable", games: [] });
  });

  it("gives up after the timeout", async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const search = new OnlineSearch({ fetchImpl, timeoutMs: 20 });
    expect(await search.search("elden")).toEqual({ status: "unreachable", games: [] });
  });

  it("lets a newer search replace an older one without reporting a failure", async () => {
    const pending: ((response: Response) => void)[] = [];
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((resolve, reject) => {
        pending.push(resolve);
        init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const search = new OnlineSearch({ fetchImpl });

    const first = search.search("hol");
    const second = search.search("holl");
    expect(await first).toEqual({ status: "ok", games: [] });
    pending[1]!(answer({ results: [{ id: "hollow-knight", name: "Hollow Knight" }] }));
    expect((await second).games).toHaveLength(1);
  });
});
