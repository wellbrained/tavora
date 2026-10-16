import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AiUsageView } from "../shared/host-api";
import { AiUsage, DEFAULT_MINUTES, USAGE_URL, type AiUsageDeps } from "./ai-usage";
import type { CodexReading } from "./ai-usage-codex";
import { claudeAccessToken, claudePlan, codexPlan, parseClaudeWindows, parseCodexWindows } from "./ai-usage-parse";
import { PlayerError } from "./messages";

// The credentials in these tests are made up; nothing here reads a real login.

const HOME = path.resolve("/home/tester");
const CLAUDE_DIR = path.join(HOME, ".claude");
const CODEX_DIR = path.join(HOME, ".codex");

describe("parseClaudeWindows", () => {
  it("reads the self-describing limits, keeping model scopes and inactive windows", () => {
    const windows = parseClaudeWindows({
      limits: [
        { kind: "session", percent: 12.5, resets_at: "2026-10-16T15:00:00Z", is_active: true },
        { kind: "weekly_all", percent: 40, resets_at: "2026-10-20T00:00:00Z", is_active: false },
        { kind: "weekly_scoped", percent: 70, resets_at: null, scope: { model: { display_name: "Sonnet" } } },
        { kind: "something_new", percent: 5 },
        { kind: "session", percent: 140 },
      ],
    });
    expect(windows).toEqual([
      { kind: "five-hour", name: null, usedPercent: 12.5, resetsAt: Date.parse("2026-10-16T15:00:00Z") },
      { kind: "weekly", name: null, usedPercent: 40, resetsAt: Date.parse("2026-10-20T00:00:00Z") },
      { kind: "weekly", name: "Sonnet", usedPercent: 70, resetsAt: null },
      { kind: "other", name: "something_new", usedPercent: 5, resetsAt: null },
    ]);
  });

  it("falls back to the older flat fields", () => {
    const windows = parseClaudeWindows({ five_hour: { utilization: 10, resets_at: "2026-10-16T15:00:00Z" }, seven_day: { utilization: 20 }, seven_day_opus: { utilization: 30 } });
    expect(windows.map((w) => [w.kind, w.name, w.usedPercent])).toEqual([
      ["five-hour", null, 10],
      ["weekly", null, 20],
      ["weekly", "Opus", 30],
    ]);
  });

  it("returns nothing for answers it does not understand, never zeros", () => {
    for (const answer of [null, "x", 5, [], {}, { limits: [] }, { limits: [{ kind: "session" }] }, { five_hour: { utilization: "10" } }]) {
      expect(parseClaudeWindows(answer)).toEqual([]);
    }
  });

  it("cleans names from the provider", () => {
    const [window] = parseClaudeWindows({ limits: [{ kind: "weekly_scoped", percent: 1, scope: { model: { display_name: `Son\u0007net${"x".repeat(100)}` } } }] });
    expect(window?.name).toBe(`Sonnet${"x".repeat(34)}`);
  });
});

describe("parseCodexWindows", () => {
  it("names windows by their length and keeps extra limits' own names", () => {
    const windows = parseCodexWindows({
      rateLimitsByLimitId: {
        codex: { limitName: null, primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_760_000_000 }, secondary: { usedPercent: 50, windowDurationMins: 10_080, resetsAt: 1_760_500_000 } },
        spark: { limitName: "GPT-Spark", primary: { usedPercent: 1, windowDurationMins: 4320 } },
      },
    });
    expect(windows).toEqual([
      { kind: "five-hour", name: null, usedPercent: 25, resetsAt: 1_760_000_000_000 },
      { kind: "weekly", name: null, usedPercent: 50, resetsAt: 1_760_500_000_000 },
      { kind: "other", name: "3-day · GPT-Spark", usedPercent: 1, resetsAt: null },
    ]);
  });

  it("uses the single older bucket when there is no list", () => {
    expect(parseCodexWindows({ rateLimits: { primary: { usedPercent: 9, windowDurationMins: 300 } } })).toEqual([{ kind: "five-hour", name: null, usedPercent: 9, resetsAt: null }]);
  });

  it("ignores broken windows and impossible reset times", () => {
    const windows = parseCodexWindows({ rateLimits: { primary: { usedPercent: "9" }, secondary: { usedPercent: 3, windowDurationMins: 90, resetsAt: 9e15 } } });
    expect(windows).toEqual([{ kind: "other", name: "90-minute", usedPercent: 3, resetsAt: null }]);
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

// ── The service ─────────────────────────────────────────────────────────

const CLAUDE_LOGIN = JSON.stringify({ claudeAiOauth: { accessToken: "test-token", subscriptionType: "pro" } });
const USAGE_ANSWER = { limits: [{ kind: "session", percent: 30, resets_at: "2026-10-16T15:00:00Z" }] };

function setup(overrides: Partial<AiUsageDeps> = {}, files: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(files));
  const views: AiUsageView[] = [];
  const clock = { now: Date.parse("2026-10-16T12:00:00Z") };
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(USAGE_ANSWER), { status: 200 }));
  const codex = vi.fn(async (): Promise<CodexReading> => ({ signedIn: true, apiKey: false, limits: { rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300 } } } }));
  const deps: AiUsageDeps = {
    file: path.join(HOME, "ai-usage.json"),
    version: "9.9.9",
    fetch: fetchMock as unknown as typeof fetch,
    readText: async (file) => store.get(file) ?? null,
    isDirectory: async (directory) => directory.startsWith(HOME),
    writeText: async (file, text) => void store.set(file, text),
    readCodex: codex,
    detect: async () => [
      { provider: "claude", directory: CLAUDE_DIR },
      { provider: "codex", directory: CODEX_DIR },
    ],
    now: () => clock.now,
    onChange: (view) => views.push(view),
    ...overrides,
  };
  store.set(path.join(CLAUDE_DIR, ".credentials.json"), CLAUDE_LOGIN);
  const usage = new AiUsage(deps);
  return { usage, store, views, clock, fetchMock, codex, deps };
}

describe("AiUsage", () => {
  it("offers the profile folders found on this PC the first time only", async () => {
    const { usage, store, deps } = setup();
    const view = await usage.view();
    expect(view.accounts.map((a) => [a.provider, a.label, a.directory])).toEqual([
      ["claude", "claude", CLAUDE_DIR],
      ["codex", "codex", CODEX_DIR],
    ]);
    expect(view.accounts[0]?.plan).toBe("Pro");
    expect(view.refreshMinutes).toBe(DEFAULT_MINUTES);
    // A second start reads the saved file; removing everything does not bring the defaults back.
    const again = new AiUsage({ ...deps, detect: async () => [{ provider: "claude", directory: CLAUDE_DIR }] });
    const saved = await again.view();
    expect(saved.accounts).toHaveLength(2);
    for (const account of saved.accounts) await again.remove(account.id);
    expect((await new AiUsage(deps).view()).accounts).toEqual([]);
    expect(store.has(deps.file)).toBe(true);
  });

  it("reads a Claude account with the login's token and shows the windows", async () => {
    const { usage, fetchMock } = setup({ detect: async () => [{ provider: "claude", directory: CLAUDE_DIR }] });
    await usage.refreshNow();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(USAGE_URL);
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-token");
    const [account] = (await usage.view()).accounts;
    expect(account).toMatchObject({ state: "ready", stale: false, fetchedAt: Date.parse("2026-10-16T12:00:00Z") });
    expect(account?.windows).toEqual([{ kind: "five-hour", name: null, usedPercent: 30, resetsAt: Date.parse("2026-10-16T15:00:00Z") }]);
  });

  it("never saves or shows the token", async () => {
    const { usage, store, views } = setup({ detect: async () => [{ provider: "claude", directory: CLAUDE_DIR }] });
    await usage.refreshNow();
    expect(store.get(path.join(HOME, "ai-usage.json"))).not.toContain("test-token");
    expect(JSON.stringify(views)).not.toContain("test-token");
  });

  it("reads a Codex account through the Codex command", async () => {
    const { usage, codex } = setup({ detect: async () => [{ provider: "codex", directory: CODEX_DIR }] });
    await usage.refreshNow();
    expect(codex).toHaveBeenCalledWith(CODEX_DIR, expect.any(AbortSignal));
    expect((await usage.view()).accounts[0]).toMatchObject({ state: "ready", windows: [{ kind: "five-hour", usedPercent: 10 }] });
  });

  it("maps failures to states and keeps the last reading as stale", async () => {
    const { usage, fetchMock, clock } = setup({ detect: async () => [{ provider: "claude", directory: CLAUDE_DIR }] });
    await usage.refreshNow();
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 401 }));
    clock.now += 10 * 60_000;
    await usage.refreshNow();
    expect((await usage.view()).accounts[0]).toMatchObject({ state: "sign-in", stale: true, windows: [{ usedPercent: 30 }] });
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    clock.now += 60 * 60_000;
    await usage.refreshNow();
    expect((await usage.view()).accounts[0]?.state).toBe("unavailable");
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    clock.now += 24 * 3_600_000;
    await usage.refreshNow();
    expect((await usage.view()).accounts[0]?.state).toBe("unavailable");
  });

  it("says sign-in when there is no login, without a request", async () => {
    const { usage, fetchMock, store } = setup({ detect: async () => [{ provider: "claude", directory: CLAUDE_DIR }] });
    store.delete(path.join(CLAUDE_DIR, ".credentials.json"));
    await usage.refreshNow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await usage.view()).accounts[0]?.state).toBe("sign-in");
  });

  it("reports a missing Codex command, an API-key login and a missing sign-in", async () => {
    const { CodexMissingError } = await import("./ai-usage-codex");
    const { usage, codex, clock } = setup({ detect: async () => [{ provider: "codex", directory: CODEX_DIR }] });
    codex.mockRejectedValueOnce(new CodexMissingError());
    await usage.refreshNow();
    expect((await usage.view()).accounts[0]?.state).toBe("cli-missing");
    clock.now += 10 * 3_600_000;
    codex.mockResolvedValueOnce({ signedIn: true, apiKey: true, limits: null });
    await usage.refreshNow();
    expect((await usage.view()).accounts[0]?.state).toBe("unavailable");
    clock.now += 10 * 3_600_000;
    codex.mockResolvedValueOnce({ signedIn: false, apiKey: false, limits: null });
    await usage.refreshNow();
    expect((await usage.view()).accounts[0]?.state).toBe("sign-in");
  });

  it("respects a provider's wait time, also for the refresh button", async () => {
    const { usage, fetchMock, clock } = setup({ detect: async () => [{ provider: "claude", directory: CLAUDE_DIR }] });
    fetchMock.mockResolvedValueOnce(new Response("slow", { status: 429, headers: { "retry-after": "1800" } }));
    await usage.refreshNow();
    expect((await usage.view()).accounts[0]?.state).toBe("rate-limited");
    clock.now += 10 * 60_000;
    await usage.refreshNow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock.now += 30 * 60_000;
    await usage.refreshNow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads on its own only when an account is due, and backs off after failures", async () => {
    const { usage, fetchMock, clock } = setup({ detect: async () => [{ provider: "claude", directory: CLAUDE_DIR }] });
    await usage.tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock.now += 4 * 60_000;
    await usage.tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock.now += 2 * 60_000;
    await usage.tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    clock.now += 6 * 60_000;
    await usage.tick();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // One failure doubles the wait: ten minutes.
    clock.now += 6 * 60_000;
    await usage.tick();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    clock.now += 5 * 60_000;
    await usage.tick();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("marks an overdue reading as stale", async () => {
    const { usage, clock } = setup({ detect: async () => [{ provider: "claude", directory: CLAUDE_DIR }] });
    await usage.refreshNow();
    clock.now += 20 * 60_000;
    expect((await usage.view()).accounts[0]?.stale).toBe(true);
  });

  it("takes no readings until a panel is open", async () => {
    vi.useFakeTimers();
    try {
      const { usage, fetchMock } = setup({ detect: async () => [{ provider: "claude", directory: CLAUDE_DIR }] });
      await usage.view();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fetchMock).not.toHaveBeenCalled();
      await usage.setWanted(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await usage.setWanted(false);
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks accounts before adding or changing them", async () => {
    const { usage } = setup({ detect: async () => [{ provider: "claude", directory: CLAUDE_DIR }] });
    const key = (promise: Promise<unknown>) => promise.then(() => "ok", (error: unknown) => (error instanceof PlayerError ? error.key : "other"));
    expect(await key(usage.add("codex", "  ", CODEX_DIR))).toBe("aiUsage.error.label");
    expect(await key(usage.add("codex", "x".repeat(61), CODEX_DIR))).toBe("aiUsage.error.label");
    expect(await key(usage.add("codex", "Work", "relative/folder"))).toBe("aiUsage.error.directory");
    expect(await key(usage.add("codex", "Work", path.resolve("/elsewhere")))).toBe("aiUsage.error.directory");
    expect(await key(usage.add("claude", "Again", CLAUDE_DIR))).toBe("aiUsage.error.duplicate");
    expect(await key(usage.add("codex", "Work", CODEX_DIR))).toBe("ok");
    expect(await key(usage.update("00000000-0000-4000-8000-000000000000", "A", CODEX_DIR))).toBe("aiUsage.error.unknown");
    expect(await key(usage.remove("00000000-0000-4000-8000-000000000000"))).toBe("aiUsage.error.unknown");
  });

  it("forgets the old reading when an account moves to another folder", async () => {
    const { usage } = setup({ detect: async () => [{ provider: "claude", directory: CLAUDE_DIR }] });
    await usage.refreshNow();
    const [account] = (await usage.view()).accounts;
    await usage.update(account!.id, "Renamed", CLAUDE_DIR);
    expect((await usage.view()).accounts[0]).toMatchObject({ label: "Renamed", windows: [{ usedPercent: 30 }] });
    await usage.update(account!.id, "Renamed", path.join(HOME, ".claude-other"));
    expect((await usage.view()).accounts[0]).toMatchObject({ windows: [], fetchedAt: null, state: "waiting" });
  });

  it("limits the number of accounts and the refresh interval", async () => {
    const { usage } = setup({ detect: async () => [] });
    for (let n = 0; n < 20; n++) await usage.add("claude", `A${n}`, path.join(HOME, `.claude-${n}`));
    await expect(usage.add("claude", "One more", path.join(HOME, ".claude-extra"))).rejects.toMatchObject({ key: "aiUsage.error.limit" });
    await usage.setInterval(500);
    expect((await usage.view()).refreshMinutes).toBe(60);
    await usage.setInterval(0);
    expect((await usage.view()).refreshMinutes).toBe(1);
  });

  it("starts empty from a damaged file instead of failing", async () => {
    const { usage } = setup({ detect: async () => [] }, { [path.join(HOME, "ai-usage.json")]: "{not json" });
    expect((await usage.view()).accounts).toEqual([]);
  });

  it("drops saved accounts and readings that are not valid", async () => {
    const saved = JSON.stringify({
      version: 1,
      refreshMinutes: 15,
      accounts: [
        { id: "a", provider: "claude", label: "Good", directory: CLAUDE_DIR },
        { id: "b", provider: "gemini", label: "Bad provider", directory: CLAUDE_DIR },
        { id: "c", provider: "claude", label: "Relative", directory: "rel" },
      ],
      readings: { a: { fetchedAt: 1, windows: [{ kind: "weekly", name: null, usedPercent: 20, resetsAt: null }, { kind: "nope" }] } },
    });
    const { usage } = setup({}, { [path.join(HOME, "ai-usage.json")]: saved });
    const view = await usage.view();
    expect(view.refreshMinutes).toBe(15);
    expect(view.accounts.map((a) => a.id)).toEqual(["a"]);
    expect(view.accounts[0]?.windows).toHaveLength(1);
  });
});
