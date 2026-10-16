import type { AiUsageAccountInfo, AiUsageReading, JsonValue, TavoraSDK } from "@tavora/sdk";
import { TavoraError } from "@tavora/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMonitor } from "./monitor";

const CLAUDE: AiUsageAccountInfo = { id: "c1", provider: "claude", label: "Work", plan: "Pro" };
const CODEX: AiUsageAccountInfo = { id: "x1", provider: "codex", label: "Home", plan: "Plus" };
const START = Date.parse("2026-10-17T12:00:00Z");
const CLAUDE_ANSWER = { limits: [{ kind: "session", percent: 30, resets_at: "2026-10-17T15:00:00Z" }] };
const CODEX_ANSWER = { rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300 } }, rateLimitResetCredits: { availableCount: 2 } };

/** An SDK with only what the monitor uses: settings shared by every game and the ai-usage connector. */
function fakeSdk(accounts: AiUsageAccountInfo[] = [CLAUDE, CODEX]) {
  const app = new Map<string, JsonValue>();
  const read = vi.fn(async (id: string): Promise<AiUsageReading> => {
    const account = accounts.find((item) => item.id === id)!;
    return { status: "ok", retryAfterMs: null, answer: account.provider === "claude" ? CLAUDE_ANSWER : CODEX_ANSWER, email: `${id}@example.com`, plan: account.plan, readAt: new Date(Date.now()).toISOString() };
  });
  const list = vi.fn(async () => accounts.map((account) => ({ ...account })));
  const sdk = {
    storage: {
      app: {
        get: async (key: string) => (app.has(key) ? structuredClone(app.get(key)!) : null),
        set: async (key: string, value: JsonValue) => void app.set(key, structuredClone(value)),
        delete: async (key: string) => void app.delete(key),
        keys: async () => [...app.keys()],
      },
    },
    connectors: { aiUsage: { accounts: list, read, onAccountsChange: () => () => {} } },
  } as unknown as TavoraSDK;
  return { sdk, app, read, list };
}

/** Lets the monitor's chain of awaits run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

describe("monitor", () => {
  it("reads every account when it starts, in the player's order, and keeps the readings for every game", async () => {
    const { sdk, app, read } = fakeSdk();
    app.set("order", ["x1", "c1"]);
    const monitor = createMonitor(sdk);
    await monitor.start();
    await settle();
    expect(read.mock.calls.map(([id]) => id)).toEqual(["x1", "c1"]);
    const [codex, claude] = monitor.accounts.value;
    expect(codex).toMatchObject({ status: "ok", email: "x1@example.com", resets: { available: 2, earliestExpiry: null } });
    expect(claude).toMatchObject({ status: "ok", resets: null, reading: { fetchedAt: START, windows: [{ kind: "five-hour", usedPercent: 30 }] } });
    expect(Object.keys(app.get("readings") as object).sort()).toEqual(["c1", "x1"]);
    // The email is shown, never kept.
    expect(JSON.stringify([...app.values()])).not.toContain("@example.com");
    monitor.stop();
  });

  it("shows what Tavora's built-in panel left until the first reading comes", async () => {
    const { sdk, app, read } = fakeSdk([CLAUDE]);
    app.set("readings", { c1: { fetchedAt: START - 3_600_000, windows: [{ kind: "weekly", name: null, usedPercent: 20, resetsAt: null }] } });
    app.set("settings", { refreshMinutes: 15, style: "used" });
    read.mockImplementation(() => new Promise(() => {}));
    const monitor = createMonitor(sdk);
    await monitor.start();
    expect(monitor.settings.value).toEqual({ refreshMinutes: 15, style: "used" });
    expect(monitor.accounts.value[0]).toMatchObject({ status: "waiting", reading: { windows: [{ usedPercent: 20 }] } });
    monitor.stop();
  });

  it("reads again after the interval, and backs off after failures", async () => {
    const { sdk, read } = fakeSdk([CLAUDE]);
    const monitor = createMonitor(sdk);
    await monitor.start();
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    read.mockResolvedValue({ status: "unavailable", retryAfterMs: null, answer: null, email: null, plan: null, readAt: new Date().toISOString() });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(read).toHaveBeenCalledTimes(3);
    // One failure doubles the wait: ten minutes.
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(read).toHaveBeenCalledTimes(4);
    // A failure keeps the last good reading.
    expect(monitor.accounts.value[0]).toMatchObject({ status: "unavailable", reading: { windows: [{ usedPercent: 30 }] } });
    monitor.stop();
  });

  it("counts an answer with nothing recognisable as unavailable", async () => {
    const { sdk, read } = fakeSdk([CLAUDE]);
    read.mockResolvedValue({ status: "ok", retryAfterMs: null, answer: { something: "new" }, email: null, plan: null, readAt: new Date().toISOString() });
    const monitor = createMonitor(sdk);
    await monitor.start();
    await settle();
    expect(monitor.accounts.value[0]).toMatchObject({ status: "unavailable", reading: null });
    monitor.stop();
  });

  it("respects a provider's wait time, also for the refresh button", async () => {
    const { sdk, read } = fakeSdk([CLAUDE]);
    read.mockResolvedValueOnce({ status: "rate-limited", retryAfterMs: 30 * 60_000, answer: null, email: null, plan: null, readAt: new Date().toISOString() });
    const monitor = createMonitor(sdk);
    await monitor.start();
    await settle();
    expect(monitor.accounts.value[0]?.status).toBe("rate-limited");
    await monitor.refreshNow();
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(read).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it("takes no readings while the panel is hidden", async () => {
    const { sdk, read } = fakeSdk([CLAUDE]);
    const monitor = createMonitor(sdk);
    await monitor.start();
    await settle();
    monitor.suspend();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(read).toHaveBeenCalledTimes(1);
    monitor.resume();
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it("says when the player has not allowed the connector, and reads nothing", async () => {
    const { sdk, list, read } = fakeSdk();
    list.mockRejectedValue(new TavoraError({ code: "PERMISSION_DENIED", message: "no", capability: "aiUsage" }));
    const monitor = createMonitor(sdk);
    await monitor.start();
    await settle();
    expect(monitor.denied.value).toBe(true);
    expect(read).not.toHaveBeenCalled();
    monitor.stop();
  });

  it("saves the order and the settings for every game", async () => {
    const { sdk, app } = fakeSdk();
    const monitor = createMonitor(sdk);
    await monitor.start();
    await monitor.move("x1", -1);
    expect(app.get("order")).toEqual(["x1", "c1"]);
    expect(monitor.accounts.value.map((account) => account.info.id)).toEqual(["x1", "c1"]);
    await monitor.setSettings({ style: "used" });
    expect(app.get("settings")).toEqual({ refreshMinutes: 5, style: "used" });
    monitor.stop();
  });

  it("shows new accounts when the player adds them in Settings, and forgets removed ones", async () => {
    const accounts = [CLAUDE];
    const { sdk, read, app } = fakeSdk(accounts);
    const monitor = createMonitor(sdk);
    await monitor.start();
    await settle();
    accounts.splice(0, 1, CODEX);
    await monitor.accountsChanged();
    await settle();
    expect(monitor.accounts.value.map((account) => account.info.id)).toEqual(["x1"]);
    expect(read.mock.calls.map(([id]) => id)).toEqual(["c1", "x1"]);
    expect(Object.keys(app.get("readings") as object)).toEqual(["x1"]);
    monitor.stop();
  });
});
