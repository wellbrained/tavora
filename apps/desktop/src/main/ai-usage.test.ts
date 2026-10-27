import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AiUsageView } from "../shared/host-api";
import { AiUsageConnector, MAX_ANSWER_BYTES, USAGE_URL, type AiUsageDeps } from "./ai-usage";
import { parseClaudeStatus } from "./ai-usage-claude";
import { profileEnv } from "./ai-usage-cli";
import { CodexMissingError, type CodexReading } from "./ai-usage-codex";
import { claudeAccessToken, claudePlan, codexPlan, parseEmail } from "./ai-usage-parse";
import { HostError } from "./errors";
import { UserError } from "./messages";

// The credentials in these tests are made up; nothing here reads a real login.

const HOME = path.resolve("/home/tester");
const CLAUDE_DIR = path.join(HOME, ".claude");
const CODEX_DIR = path.join(HOME, ".codex");
const FILE = path.join(HOME, "ai-usage.json");

describe("emails", () => {
  it("accepts one plain address and nothing else", () => {
    expect(parseEmail("me.name+tag@example.com")).toBe("me.name+tag@example.com");
    for (const value of ["a@b", "a b@c.de", "<x>@c.de", "a@c.de\nb@c.de", 'a"@c.de', "", null, 5, `${"x".repeat(250)}@c.de`]) {
      expect(parseEmail(value)).toBeNull();
    }
  });

  it("takes Claude's email only when `claude auth status` says the profile is signed in", () => {
    expect(parseClaudeStatus(JSON.stringify({ loggedIn: true, email: "me@example.com", orgName: "x" }))).toBe("me@example.com");
    expect(parseClaudeStatus(JSON.stringify({ loggedIn: false, email: "me@example.com" }))).toBeNull();
    expect(parseClaudeStatus(JSON.stringify({ loggedIn: true, email: "not an email" }))).toBeNull();
    expect(parseClaudeStatus("Logged in as me@example.com")).toBeNull();
  });
});

describe("plans and tokens", () => {
  it("reads Claude's plan from a fixed list of names", () => {
    expect(claudePlan({ claudeAiOauth: { subscriptionType: "pro" } })).toBe("Pro");
    expect(claudePlan({ claudeAiOauth: { subscriptionType: "max", rateLimitTier: "default_claude_max_20x" } })).toBe("Max 20×");
    expect(claudePlan({ claudeAiOauth: { subscriptionType: "max" } })).toBe("Max");
    expect(claudePlan({ claudeAiOauth: { subscriptionType: "<script>" } })).toBeNull();
    expect(claudePlan({})).toBeNull();
  });

  it("reads Codex's plan from the ID token's claim without checking it", () => {
    const claims = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } })).toString("base64url");
    expect(codexPlan({ tokens: { id_token: `a.${claims}.c` } })).toBe("Plus");
    expect(codexPlan({ auth_mode: "apikey" })).toBe("API key");
    expect(codexPlan({ tokens: { id_token: "nonsense" } })).toBeNull();
    expect(codexPlan({ tokens: { id_token: "a.%%%.c" } })).toBeNull();
  });

  it("finds the access token only when it is usable", () => {
    expect(claudeAccessToken({ claudeAiOauth: { accessToken: "abc" } })).toBe("abc");
    expect(claudeAccessToken({ claudeAiOauth: { accessToken: "  " } })).toBeNull();
    expect(claudeAccessToken(null)).toBeNull();
  });
});

describe("profileEnv", () => {
  it("points the command line at the profile and removes every key that would bill something else", () => {
    const env = profileEnv("claude", CLAUDE_DIR, { PATH: "/bin", ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: "https://elsewhere", CLAUDE_CODE_OAUTH_TOKEN: "t", OPENAI_API_KEY: "o" });
    expect(env).toEqual({ PATH: "/bin", CLAUDE_CONFIG_DIR: CLAUDE_DIR });
    expect(profileEnv("codex", CODEX_DIR, { CODEX_API_KEY: "c" })).toEqual({ CODEX_HOME: CODEX_DIR });
  });
});

// ── The connector ───────────────────────────────────────────────────────

const CLAUDE_LOGIN = JSON.stringify({ claudeAiOauth: { accessToken: "test-token", subscriptionType: "pro" } });
const USAGE_ANSWER = { limits: [{ kind: "session", percent: 30, resets_at: "2026-10-16T15:00:00Z", is_active: true }], extra_usage: { is_enabled: false } };
const CODEX_LIMITS = { rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300 } }, rateLimitResetCredits: { availableCount: 3 } };

function setup(overrides: Partial<AiUsageDeps> = {}, files: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(files));
  const views: AiUsageView[] = [];
  const clock = { now: Date.parse("2026-10-16T12:00:00Z") };
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(USAGE_ANSWER), { status: 200 }));
  const codex = vi.fn(async (): Promise<CodexReading> => ({ signedIn: true, apiKey: false, email: "codex@example.com", limits: CODEX_LIMITS }));
  const email = vi.fn(async (_directory: string): Promise<string | null> => "claude@example.com");
  const deps: AiUsageDeps = {
    file: FILE,
    version: "9.9.9",
    fetch: fetchMock as unknown as typeof fetch,
    readText: async (file) => store.get(file) ?? null,
    isDirectory: async (directory) => directory.startsWith(HOME),
    writeText: async (file, text) => void store.set(file, text),
    readCodex: codex,
    readClaudeEmail: email,
    detect: async () => [
      { provider: "claude", directory: CLAUDE_DIR },
      { provider: "codex", directory: CODEX_DIR },
    ],
    now: () => clock.now,
    onChange: (view) => views.push(view),
    ...overrides,
  };
  store.set(path.join(CLAUDE_DIR, ".credentials.json"), CLAUDE_LOGIN);
  const connector = new AiUsageConnector(deps);
  return { connector, store, views, clock, fetchMock, codex, email, deps };
}

const onlyClaude = { detect: async () => [{ provider: "claude" as const, directory: CLAUDE_DIR }] };
const onlyCodex = { detect: async () => [{ provider: "codex" as const, directory: CODEX_DIR }] };

async function firstId(connector: AiUsageConnector): Promise<string> {
  return (await connector.accountInfos())[0]!.id;
}

describe("AiUsageConnector accounts", () => {
  it("offers the profile folders found on this PC the first time only", async () => {
    const { connector, store, deps } = setup();
    const view = await connector.view();
    expect(view.accounts.map((a) => [a.provider, a.label, a.directory, a.plan])).toEqual([
      ["claude", "claude", CLAUDE_DIR, "Pro"],
      ["codex", "codex", CODEX_DIR, null],
    ]);
    // A second start reads the saved file; removing everything does not bring the defaults back.
    const again = new AiUsageConnector({ ...deps, detect: async () => [{ provider: "claude", directory: CLAUDE_DIR }] });
    const saved = await again.view();
    expect(saved.accounts).toHaveLength(2);
    for (const account of saved.accounts) await again.remove(account.id);
    expect((await new AiUsageConnector(deps).view()).accounts).toEqual([]);
    expect(JSON.parse(store.get(FILE)!)).toEqual({ version: 2, accounts: [] });
  });

  it("gives modules the accounts without their folders", async () => {
    const { connector } = setup();
    const infos = await connector.accountInfos();
    expect(infos.map((info) => Object.keys(info).sort())).toEqual([
      ["id", "label", "plan", "provider"],
      ["id", "label", "plan", "provider"],
    ]);
    expect(JSON.stringify(infos)).not.toContain(HOME);
  });

  it("checks accounts before adding or changing them", async () => {
    const { connector } = setup(onlyClaude);
    const key = (promise: Promise<unknown>) => promise.then(() => "ok", (error: unknown) => (error instanceof UserError ? error.key : "other"));
    expect(await key(connector.add("codex", "  ", CODEX_DIR))).toBe("aiUsage.error.label");
    expect(await key(connector.add("codex", "x".repeat(61), CODEX_DIR))).toBe("aiUsage.error.label");
    expect(await key(connector.add("codex", "Work", "relative/folder"))).toBe("aiUsage.error.directory");
    expect(await key(connector.add("codex", "Work", path.resolve("/elsewhere")))).toBe("aiUsage.error.directory");
    expect(await key(connector.add("claude", "Again", CLAUDE_DIR))).toBe("aiUsage.error.duplicate");
    expect(await key(connector.add("codex", "Work", CODEX_DIR))).toBe("ok");
    expect(await key(connector.update("00000000-0000-4000-8000-000000000000", "A", CODEX_DIR))).toBe("aiUsage.error.unknown");
    expect(await key(connector.remove("00000000-0000-4000-8000-000000000000"))).toBe("aiUsage.error.unknown");
  });

  it("tells Settings and modules when the accounts change", async () => {
    const { connector, views } = setup(onlyClaude);
    await connector.add("codex", "Work", CODEX_DIR);
    const id = await firstId(connector);
    await connector.update(id, "Renamed", CLAUDE_DIR);
    await connector.remove(id);
    expect(views.map((view) => view.accounts.map((a) => a.label))).toEqual([["claude", "Work"], ["Renamed", "Work"], ["Work"]]);
  });

  it("limits the number of accounts", async () => {
    const { connector } = setup({ detect: async () => [] });
    for (let n = 0; n < 20; n++) await connector.add("claude", `A${n}`, path.join(HOME, `.claude-${n}`));
    await expect(connector.add("claude", "One more", path.join(HOME, ".claude-extra"))).rejects.toMatchObject({ key: "aiUsage.error.limit" });
  });

  it("starts empty from a damaged file instead of failing, and offers nothing", async () => {
    const { connector } = setup({}, { [FILE]: "{not json" });
    expect((await connector.view()).accounts).toEqual([]);
  });

  it("drops saved accounts that are not valid", async () => {
    const saved = JSON.stringify({
      version: 2,
      accounts: [
        { id: "a", provider: "claude", label: "Good", directory: CLAUDE_DIR },
        { id: "a", provider: "claude", label: "Same id", directory: CODEX_DIR },
        { id: "b", provider: "gemini", label: "Bad provider", directory: CLAUDE_DIR },
        { id: "c", provider: "claude", label: "Relative", directory: "rel" },
      ],
    });
    const { connector } = setup({}, { [FILE]: saved });
    expect((await connector.view()).accounts.map((a) => a.label)).toEqual(["Good"]);
  });
});

describe("AiUsageConnector reads", () => {
  it("reads a Claude account with the login's token and hands over the answer as it came", async () => {
    const { connector, fetchMock, email } = setup(onlyClaude);
    const reading = await connector.read(await firstId(connector));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(USAGE_URL);
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-token");
    expect(init?.redirect).toBe("error");
    expect(email).toHaveBeenCalledWith(CLAUDE_DIR);
    expect(reading).toEqual({ status: "ok", retryAfterMs: null, answer: USAGE_ANSWER, email: "claude@example.com", plan: "Pro", readAt: "2026-10-16T12:00:00.000Z" });
  });

  it("asks a test server instead when one is set", async () => {
    const { connector, fetchMock } = setup({ ...onlyClaude, usageUrl: "http://127.0.0.1:9/usage" });
    await connector.read(await firstId(connector));
    expect(fetchMock.mock.calls[0]![0]).toBe("http://127.0.0.1:9/usage");
  });

  it("never saves the token or hands it to a module, and never saves an email", async () => {
    const { connector, store, views } = setup(onlyClaude);
    const reading = await connector.read(await firstId(connector));
    expect(JSON.stringify(reading)).not.toContain("test-token");
    expect(store.get(FILE)).not.toContain("test-token");
    expect(store.get(FILE)).not.toContain("claude@example.com");
    expect(JSON.stringify(views)).not.toContain("test-token");
  });

  it("reads a Codex account through the Codex command", async () => {
    const { connector, codex } = setup(onlyCodex);
    const reading = await connector.read(await firstId(connector));
    expect(codex).toHaveBeenCalledWith(CODEX_DIR, expect.any(AbortSignal));
    expect(reading).toMatchObject({ status: "ok", answer: CODEX_LIMITS, email: "codex@example.com" });
  });

  it("says sign-in when there is no login, without a request", async () => {
    const { connector, fetchMock, store } = setup(onlyClaude);
    store.delete(path.join(CLAUDE_DIR, ".credentials.json"));
    expect(await connector.read(await firstId(connector))).toMatchObject({ status: "sign-in", answer: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a refused login", () => new Response("no", { status: 401 }), "sign-in"],
    ["a server error", () => new Response("", { status: 500 }), "unavailable"],
    ["an answer that is not JSON", () => new Response("<html>", { status: 200 }), "unavailable"],
    ["an answer far too big", () => new Response(JSON.stringify({ x: "y".repeat(MAX_ANSWER_BYTES) }), { status: 200 }), "unavailable"],
  ])("maps %s to a status, with no details", async (_name, answer, status) => {
    const { connector, fetchMock } = setup(onlyClaude);
    fetchMock.mockImplementationOnce(async () => answer());
    expect(await connector.read(await firstId(connector))).toMatchObject({ status, answer: null });
  });

  it("maps an unreachable provider to unavailable", async () => {
    const { connector, fetchMock } = setup(onlyClaude);
    fetchMock.mockRejectedValueOnce(new Error(`ENOTFOUND ${CLAUDE_DIR}`));
    const reading = await connector.read(await firstId(connector));
    expect(reading.status).toBe("unavailable");
    expect(JSON.stringify(reading)).not.toContain(HOME);
  });

  it("reports a missing Codex command, an API-key login and a missing sign-in", async () => {
    const { connector, codex, clock } = setup(onlyCodex);
    const id = await firstId(connector);
    codex.mockRejectedValueOnce(new CodexMissingError());
    expect((await connector.read(id)).status).toBe("cli-missing");
    clock.now += 60_000;
    codex.mockResolvedValueOnce({ signedIn: true, apiKey: true, email: null, limits: null });
    expect((await connector.read(id)).status).toBe("api-key");
    clock.now += 60_000;
    codex.mockResolvedValueOnce({ signedIn: false, apiKey: false, email: null, limits: null });
    expect((await connector.read(id)).status).toBe("sign-in");
  });

  it("reads each account at most once a minute, for every module together", async () => {
    const { connector, fetchMock, clock } = setup(onlyClaude);
    const id = await firstId(connector);
    const [a, b] = await Promise.all([connector.read(id), connector.read(id)]);
    expect(a).toEqual(b);
    clock.now += 59_000;
    expect(await connector.read(id)).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock.now += 1_000;
    await connector.read(id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("respects a provider's wait time and counts it down", async () => {
    const { connector, fetchMock, clock } = setup(onlyClaude);
    const id = await firstId(connector);
    fetchMock.mockResolvedValueOnce(new Response("slow", { status: 429, headers: { "retry-after": "1800" } }));
    expect(await connector.read(id)).toMatchObject({ status: "rate-limited", retryAfterMs: 1_800_000 });
    clock.now += 10 * 60_000;
    expect(await connector.read(id)).toMatchObject({ status: "rate-limited", retryAfterMs: 1_200_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock.now += 20 * 60_000;
    expect((await connector.read(id)).status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forgets the last reading when an account moves to another folder", async () => {
    const { connector, fetchMock, store } = setup(onlyClaude);
    const other = path.join(HOME, ".claude-other");
    store.set(path.join(other, ".credentials.json"), CLAUDE_LOGIN);
    const id = await firstId(connector);
    await connector.read(id);
    await connector.update(id, "Renamed", CLAUDE_DIR);
    await connector.read(id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await connector.update(id, "Renamed", other);
    await connector.read(id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses an account that does not exist", async () => {
    const { connector } = setup(onlyClaude);
    await expect(connector.read("nope")).rejects.toBeInstanceOf(HostError);
  });
});

describe("the built-in panel's settings", () => {
  const VERSION_1 = JSON.stringify({
    version: 1,
    refreshMinutes: 15,
    style: "used",
    accounts: [{ id: "a", provider: "claude", label: "Good", directory: CLAUDE_DIR }],
    readings: { a: { fetchedAt: 1, windows: [{ kind: "weekly", name: null, usedPercent: 20, resetsAt: null }] }, gone: { fetchedAt: 1, windows: [] } },
  });

  it("are handed over once from version 1 of the file, then dropped from it", async () => {
    const { connector, store, deps } = setup({}, { [FILE]: VERSION_1 });
    expect(await connector.legacyPanelData()).toEqual({
      refreshMinutes: 15,
      style: "used",
      readings: { a: { fetchedAt: 1, windows: [{ kind: "weekly", name: null, usedPercent: 20, resetsAt: null }] } },
    });
    await connector.forgetLegacyPanelData();
    expect(JSON.parse(store.get(FILE)!)).toEqual({ version: 2, accounts: [{ id: "a", provider: "claude", label: "Good", directory: CLAUDE_DIR }] });
    expect(await connector.legacyPanelData()).toBeNull();
    expect(await new AiUsageConnector(deps).legacyPanelData()).toBeNull();
  });

  it("are asked for at start without looking for accounts or reading a login", async () => {
    const detect = vi.fn(async () => [{ provider: "claude" as const, directory: CLAUDE_DIR }]);
    const reads: string[] = [];
    const { connector, store } = setup({ detect, readText: async (file) => (reads.push(file), null) });
    expect(await connector.legacyPanelData()).toBeNull();
    expect(detect).not.toHaveBeenCalled();
    expect(reads).toEqual([FILE]);
    expect(store.has(FILE)).toBe(false);
  });

  it("are clamped and defaulted when odd", async () => {
    const { connector } = setup({}, { [FILE]: JSON.stringify({ version: 1, refreshMinutes: 500, style: "weird", accounts: [] }) });
    expect(await connector.legacyPanelData()).toEqual({ refreshMinutes: 60, style: "remaining", readings: {} });
  });
});
