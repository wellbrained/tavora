import { describe, expect, it } from "vitest";
import { askKey } from "../shared/module-request";
import { newInstallId, sendModuleRequest, voterFor } from "./module-request";

const valheim = { name: "Valheim", steamAppId: 892970, gameId: null };

describe("which games count as the same", () => {
  it("is the Steam id, else Tavora's id, else the name's letters and digits", () => {
    expect(askKey(valheim)).toBe("steam:892970");
    expect(askKey({ name: "Elden Ring", steamAppId: null, gameId: "elden-ring" })).toBe("game:elden-ring");
    expect(askKey({ name: "Siedler 3!", steamAppId: null, gameId: null })).toBe("name:siedler3");
    expect(askKey({ name: "SIEDLER  3", steamAppId: null, gameId: null })).toBe("name:siedler3");
  });
});

describe("the code sent for a vote", () => {
  it("is the same for one install and game, differs per game and install, and is never the install's number", () => {
    const install = newInstallId();
    expect(install).toMatch(/^[0-9a-f]{64}$/);
    const code = voterFor(install, valheim);
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(code).not.toBe(install);
    expect(voterFor(install, valheim)).toBe(code);
    expect(voterFor(install, { name: "Elden Ring", steamAppId: null, gameId: "elden-ring" })).not.toBe(code);
    expect(voterFor(newInstallId(), valheim)).not.toBe(code);
  });
});

describe("sendModuleRequest", () => {
  const answering = (status: number | "offline") => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (status === "offline") throw new TypeError("offline");
      return new Response(null, { status });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };

  it("sends only the game and a code, with nothing that identifies the user", async () => {
    const { calls, fetchImpl } = answering(204);
    const install = newInstallId();
    expect(await sendModuleRequest({ baseUrl: "https://api.test/", fetchImpl }, valheim, install)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.test/v1/module-requests");
    expect(calls[0]!.init).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer" });
    expect(Object.keys(calls[0]!.init.headers as Record<string, string>)).toEqual(["Content-Type"]);
    const body = JSON.parse(calls[0]!.init.body as string) as { game: Record<string, unknown>; voter: string };
    expect(body).toEqual({ game: { name: "Valheim", steamAppId: 892970 }, voter: voterFor(install, valheim) });
    expect(calls[0]!.init.body).not.toContain(install);
  });

  it("leaves out an id the game does not have", async () => {
    const { calls, fetchImpl } = answering(204);
    await sendModuleRequest({ fetchImpl }, { name: "Elden Ring", steamAppId: null, gameId: "elden-ring" }, newInstallId());
    expect(JSON.parse(calls[0]!.init.body as string).game).toEqual({ name: "Elden Ring", gameId: "elden-ring" });
  });

  it("says no, and never throws, when offline, refused, busy or when the address does not exist yet", async () => {
    for (const status of ["offline", 404, 429, 500, 503] as const) {
      const { fetchImpl } = answering(status);
      expect(await sendModuleRequest({ fetchImpl }, valheim, newInstallId())).toBe(false);
    }
  });
});
