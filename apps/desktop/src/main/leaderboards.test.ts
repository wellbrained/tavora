import { describe, expect, it } from "vitest";
import { boardsModuleId, ModuleLeaderboards, type LeaderboardAccount, type LeaderboardQuestion } from "./leaderboards";

type Request = { method: string; path: string; body?: unknown };

type Answer = { status: number; body: Record<string, unknown> };

/** A pretend service: answers by method and path (a list: one after the other), and keeps what was asked. */
function setup(options: { signedIn?: boolean; enabled?: boolean; answers?: Record<string, Answer | Answer[]>; unreachable?: boolean; answer?: boolean } = {}) {
  const requests: Request[] = [];
  const questions: LeaderboardQuestion[] = [];
  let signedIn = options.signedIn ?? true;
  const answers: Record<string, Answer | Answer[]> = {
    "GET /local.word-guess": { status: 200, body: { available: true, shown: false, name: "Mara", label: "K7" } },
    "PUT /local.word-guess/shown": { status: 200, body: { available: true, shown: true, name: "Mara", label: "K7" } },
    "DELETE /local.word-guess/shown": { status: 200, body: { available: true, shown: false, name: "Mara", label: "K7" } },
    ...options.answers,
  };
  const account: LeaderboardAccount = {
    enabled: () => options.enabled ?? true,
    isSignedIn: () => signedIn,
    leaderboardRequest: async (method, path, body) => {
      requests.push({ method, path, ...(body === undefined ? {} : { body }) });
      if (options.unreachable) throw new Error("offline");
      const listed = answers[`${method} ${path.split("?")[0]}`];
      const answer = (Array.isArray(listed) ? listed.shift() : listed) ?? { status: 404, body: { reason: "not-found" } };
      // The service forgets a sign-in it doesn't know.
      if (answer.status === 401) signedIn = false;
      return answer;
    },
  };
  const leaderboards = new ModuleLeaderboards({
    moduleId: "local.word-guess",
    boards: [
      { id: "daily", kind: "streak", daily: true },
      { id: "fastest", kind: "score", order: "low" },
    ],
    account,
    pseudonym: (label) => (label ? `User · ${label}` : "User"),
    ask: async (question) => (questions.push(question), options.answer ?? true),
  });
  return { leaderboards, requests, questions, signOut: () => (signedIn = false) };
}

describe("the boards' module id", () => {
  it("puts every copy not from the catalog on test boards, whatever id it claims", () => {
    expect(boardsModuleId("wellbrained.word-guess", true)).toBe("wellbrained.word-guess");
    expect(boardsModuleId("local.word-guess", false)).toBe("local.word-guess");
    expect(boardsModuleId("wellbrained.word-guess", false)).toBe("local.word-guess");
    expect(boardsModuleId("a.b.c.d.e", false)).toBe("local.b.c.d.e");
  });
});

describe("the leaderboard status", () => {
  it("says where the user stands, and the name the boards show only once they are on them", async () => {
    expect(await setup().leaderboards.status()).toEqual({ signedIn: true, available: true, shown: false, name: null });
    const hidden = setup({ answers: { "GET /local.word-guess": { status: 200, body: { available: true, shown: true, name: null, label: "K7" } } } });
    expect(await hidden.leaderboards.status()).toEqual({ signedIn: true, available: true, shown: true, name: "User · K7" });
  });

  it("is signed out without a sign-in, and while accounts are off asks nothing at all", async () => {
    const out = setup({ signedIn: false, answers: { "GET /local.word-guess": { status: 200, body: { available: true, shown: false, name: null, label: null } } } });
    expect(await out.leaderboards.status()).toEqual({ signedIn: false, available: true, shown: false, name: null });
    const off = setup({ enabled: false });
    expect(await off.leaderboards.status()).toEqual({ signedIn: false, available: false, shown: false, name: null });
    expect(off.requests).toEqual([]);
  });

  it("asks again as signed out when the service no longer knows the sign-in, once", async () => {
    const forgotten = { status: 401, body: { reason: "signed-out" } };
    const anonymous = { status: 200, body: { available: true, shown: false, name: null, label: null } };
    const { leaderboards, requests } = setup({ answers: { "GET /local.word-guess": [forgotten, anonymous] } });
    expect(await leaderboards.status()).toEqual({ signedIn: false, available: true, shown: false, name: null });
    expect(requests).toHaveLength(2);
    const broken = setup({ answers: { "GET /local.word-guess": [forgotten, forgotten, forgotten] } });
    await expect(broken.leaderboards.status()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(broken.requests).toHaveLength(2);
  });

  it("can't reach the service: NETWORK_ERROR", async () => {
    await expect(setup({ unreachable: true }).leaderboards.status()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});

describe("showing the user on the boards", () => {
  it("asks first, in Tavora's words with the name the boards will show, and shows them only on yes", async () => {
    const yes = setup();
    expect(await yes.leaderboards.show()).toEqual({ signedIn: true, available: true, shown: true, name: "Mara" });
    expect(yes.questions).toEqual([{ kind: "consent", name: "Mara" }]);
    expect(yes.requests.map((request) => `${request.method} ${request.path}`)).toEqual(["GET /local.word-guess", "PUT /local.word-guess/shown"]);

    const no = setup({ answer: false });
    expect(await no.leaderboards.show()).toMatchObject({ shown: false });
    expect(no.requests.map((request) => request.method)).toEqual(["GET"]);
  });

  it("doesn't ask again once shown, nor for a module without boards on the service", async () => {
    const shown = setup({ answers: { "GET /local.word-guess": { status: 200, body: { available: true, shown: true, name: "Mara", label: "K7" } } } });
    expect(await shown.leaderboards.show()).toMatchObject({ shown: true });
    const unavailable = setup({ answers: { "GET /local.word-guess": { status: 200, body: { available: false, shown: false, name: "Mara", label: null } } } });
    expect(await unavailable.leaderboards.show()).toMatchObject({ available: false, shown: false });
    expect([...shown.questions, ...unavailable.questions]).toEqual([]);
  });

  it("offers to sign in while signed out", async () => {
    const out = setup({ signedIn: false, answers: { "GET /local.word-guess": { status: 200, body: { available: true, shown: false, name: null, label: null } } } });
    expect(await out.leaderboards.show()).toMatchObject({ signedIn: false, shown: false });
    expect(out.questions).toEqual([{ kind: "sign-in" }]);
  });

  it("takes the user off the boards", async () => {
    const { leaderboards, requests } = setup();
    expect(await leaderboards.hide()).toMatchObject({ shown: false });
    expect(requests.at(-1)).toMatchObject({ method: "DELETE", path: "/local.word-guess/shown" });
  });
});

describe("sending results and reading boards", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it("sends results with the board's declaration and passes on what the service did", async () => {
    const { leaderboards, requests } = setup({
      answers: { "POST /local.word-guess/boards/daily": { status: 200, body: { accepted: [id], rejected: [{ id: "x", reason: "archive" }, { id: "y", reason: "weird" }] } } },
    });
    const sent = [{ id, outcome: "won", at: 1, day: "2026-10-28" }, { id: "x", outcome: "won", at: 1, day: "2026-10-01" }];
    // Anything else a module puts in a result stays behind.
    const results = [{ ...sent[0], note: "private" }, sent[1]];
    expect(await leaderboards.submit({ board: "daily", results })).toEqual({ accepted: [id], rejected: [{ id: "x", reason: "archive" }] });
    expect(requests.at(-1)).toEqual({ method: "POST", path: "/local.word-guess/boards/daily", body: { board: { kind: "streak", daily: "1" }, results: sent } });
  });

  it("refuses a board the manifest doesn't declare and a batch that is empty or too big", async () => {
    const { leaderboards, requests } = setup();
    await expect(leaderboards.submit({ board: "weekly", results: [{ id }] })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    await expect(leaderboards.submit({ board: "daily", results: [] })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    await expect(leaderboards.submit({ board: "daily", results: Array.from({ length: 51 }, () => ({ id })) })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    await expect(leaderboards.top({ board: "daily", limit: 101 })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    await expect(leaderboards.top({ board: "daily", day: "28.10.2026" })).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(requests).toEqual([]);
  });

  it("says why the service refused: PERMISSION_DENIED to wait for the user, NETWORK_ERROR to try later", async () => {
    const results = [{ id, outcome: "won", at: 1, day: "2026-10-28" }];
    const notShown = setup({ answers: { "POST /local.word-guess/boards/daily": { status: 403, body: { reason: "not-shown" } } } });
    await expect(notShown.leaderboards.submit({ board: "daily", results })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const busy = setup({ answers: { "POST /local.word-guess/boards/daily": { status: 429, body: { reason: "too-many" } } } });
    await expect(busy.leaderboards.submit({ board: "daily", results })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    const signedOut = setup({ signedIn: false });
    await expect(signedOut.leaderboards.submit({ board: "daily", results })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(signedOut.requests).toEqual([]);
    await expect(setup({ unreachable: true }).leaderboards.submit({ board: "daily", results })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("reads a board with names, pseudonyms and the user's own line, and nothing else", async () => {
    const { leaderboards, requests } = setup({
      answers: {
        "GET /local.word-guess/boards/fastest": {
          status: 200,
          body: { rows: [{ rank: 1, name: "Mara", self: true, value: 61_000, accountId: "never" }, { rank: 2, name: null, label: "K7", self: false, value: 70_000 }] },
        },
      },
    });
    expect(await leaderboards.top({ board: "fastest", limit: 5 })).toEqual([
      { rank: 1, name: "Mara", self: true, value: 61_000 },
      { rank: 2, name: "User · K7", self: false, value: 70_000 },
    ]);
    expect(requests.at(-1)?.path).toBe("/local.word-guess/boards/fastest?kind=score&order=low&limit=5");
  });
});
