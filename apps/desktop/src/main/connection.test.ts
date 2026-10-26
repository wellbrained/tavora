import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemConnection } from "@tavora/sdk/protocol";
import {
  CONNECTION_TICK_MS,
  connectionAccess,
  ConnectionTracker,
  ConnectionWatcher,
  DEFAULT_STORED,
  LOG_DAYS,
  prune,
  sanitizeStored,
  SETTINGS_EVERY_MS,
  type ConnectionProbe,
  type ConnectionSample,
  type ConnectionStore,
  type LocalNetwork,
  type StoredConnection,
  type StoredOutage,
} from "./connection";
import { HostError } from "./errors";
import { parseConnectionSettings, parseConnectionTarget, parseWatch } from "./system-info-parse";

const DAY = 24 * 60 * 60 * 1000;

/** A tracker fed one look every 5 seconds. */
function lookAt(at: number, over: Partial<ConnectionSample> = {}): ConnectionSample {
  return { at, windowsOffline: false, routerFound: true, routerMs: 2, internetMs: 14, downMbit: null, upMbit: null, ...over };
}

describe("ConnectionTracker", () => {
  it("is online while the pings are answered", () => {
    const tracker = new ConnectionTracker([]);
    expect(tracker.feed(lookAt(0)).changed).toBe(false);
    expect(tracker.reading("1.1.1.1")).toMatchObject({ state: "online", routerMs: 2, internetMs: 14, lossPercent: 0, since: null, routerFound: true });
    expect(tracker.outages).toEqual([]);
  });

  it("counts a single lost ping as loss, not as a drop", () => {
    const tracker = new ConnectionTracker([]);
    for (let i = 0; i < 9; i++) tracker.feed(lookAt(i * 5000));
    expect(tracker.feed(lookAt(45000, { internetMs: null })).changed).toBe(false);
    expect(tracker.feed(lookAt(50000)).changed).toBe(false);
    expect(tracker.reading("1.1.1.1")).toMatchObject({ state: "online", lossPercent: 9.1 });
    expect(tracker.outages).toEqual([]);
  });

  it("goes down after 3 lost pings in a row, from the first lost one", () => {
    const tracker = new ConnectionTracker([]);
    tracker.feed(lookAt(0));
    expect(tracker.feed(lookAt(5000, { internetMs: null })).changed).toBe(false);
    expect(tracker.feed(lookAt(10000, { internetMs: null })).changed).toBe(false);
    expect(tracker.feed(lookAt(15000, { internetMs: null })).changed).toBe(true);
    expect(tracker.reading("1.1.1.1")).toMatchObject({ state: "no-internet", since: 5000 });
    expect(tracker.outages).toEqual([{ start: 5000, end: null, kind: "no-internet" }]);
  });

  it("says the internet is down while the router answers, and the router once it lost 3 pings in a row", () => {
    const tracker = new ConnectionTracker([]);
    tracker.feed(lookAt(0));
    for (let i = 1; i <= 3; i++) tracker.feed(lookAt(i * 5000, { internetMs: null }));
    expect(tracker.reading("x").state).toBe("no-internet");
    // One or two lost router pings are not enough to change the kind.
    expect(tracker.feed(lookAt(20000, { internetMs: null, routerMs: null })).changed).toBe(false);
    expect(tracker.feed(lookAt(25000, { internetMs: null, routerMs: null })).changed).toBe(false);
    expect(tracker.reading("x").state).toBe("no-internet");
    // The third: the same drop, now of another kind.
    expect(tracker.feed(lookAt(30000, { internetMs: null, routerMs: null })).changed).toBe(true);
    expect(tracker.reading("x")).toMatchObject({ state: "no-router", since: 5000 });
    expect(tracker.outages).toEqual([{ start: 5000, end: null, kind: "no-router" }]);
  });

  it("keeps the worst kind a drop had, so it does not flip-flop", () => {
    const tracker = new ConnectionTracker([]);
    tracker.feed(lookAt(0));
    for (let i = 1; i <= 3; i++) tracker.feed(lookAt(i * 5000, { internetMs: null, routerMs: null }));
    expect(tracker.reading("x").state).toBe("no-router");
    // The router answers again while the internet does not: still the same drop, still "no-router".
    expect(tracker.feed(lookAt(20000, { internetMs: null })).changed).toBe(false);
    expect(tracker.feed(lookAt(25000, { internetMs: null, routerMs: null })).changed).toBe(false);
    expect(tracker.reading("x").state).toBe("no-router");
    expect(tracker.outages).toHaveLength(1);
    // Windows saying there is no network makes it worse, once.
    expect(tracker.feed(lookAt(30000, { internetMs: null, windowsOffline: true })).changed).toBe(true);
    expect(tracker.feed(lookAt(35000, { internetMs: null })).changed).toBe(false);
    expect(tracker.reading("x").state).toBe("offline");
    // A new drop starts from its own kind.
    tracker.feed(lookAt(40000));
    for (let i = 9; i <= 11; i++) tracker.feed(lookAt(i * 5000, { internetMs: null }));
    expect(tracker.reading("x").state).toBe("no-internet");
  });

  it("forgets the loss window when it starts over", () => {
    const tracker = new ConnectionTracker([]);
    for (let i = 0; i < 4; i++) tracker.feed(lookAt(i * 5000, { internetMs: null }));
    expect(tracker.reading("x").lossPercent).toBe(100);
    tracker.close(30000);
    expect(tracker.reading("x").lossPercent).toBe(0);
  });

  it("closes the drop with the first answer", () => {
    const tracker = new ConnectionTracker([]);
    tracker.feed(lookAt(0));
    for (let i = 1; i <= 3; i++) tracker.feed(lookAt(i * 5000, { internetMs: null }));
    expect(tracker.feed(lookAt(20000)).changed).toBe(true);
    expect(tracker.reading("x")).toMatchObject({ state: "online", since: null });
    expect(tracker.outages).toEqual([{ start: 5000, end: 20000, kind: "no-internet" }]);
    // A new drop is a new entry.
    for (let i = 5; i <= 7; i++) tracker.feed(lookAt(i * 5000, { internetMs: null }));
    expect(tracker.outages).toHaveLength(2);
    expect(tracker.outages[1]).toEqual({ start: 25000, end: null, kind: "no-internet" });
  });

  it("is down at once when Windows says there is no network", () => {
    const tracker = new ConnectionTracker([]);
    tracker.feed(lookAt(0));
    expect(tracker.feed(lookAt(5000, { windowsOffline: true, routerMs: null, internetMs: null })).changed).toBe(true);
    expect(tracker.reading("x")).toMatchObject({ state: "offline", since: 5000 });
    expect(tracker.feed(lookAt(10000)).changed).toBe(true);
    expect(tracker.outages).toEqual([{ start: 5000, end: 10000, kind: "offline" }]);
  });

  it("is 'no internet' when no router was found but Windows says there is a network (offline is Windows' word)", () => {
    const tracker = new ConnectionTracker([]);
    for (let i = 0; i < 3; i++) tracker.feed(lookAt(i * 5000, { routerFound: false, routerMs: null, internetMs: null }));
    expect(tracker.reading("x")).toMatchObject({ state: "no-internet", routerFound: false });
  });

  it("does not blame a router that never answers pings", () => {
    const tracker = new ConnectionTracker([]);
    for (let i = 0; i < 5; i++) tracker.feed(lookAt(i * 5000, { routerMs: null }));
    // The internet works: no drop, and the silent router is no loss.
    expect(tracker.reading("x")).toMatchObject({ state: "online", lossPercent: 0 });
    for (let i = 5; i < 8; i++) tracker.feed(lookAt(i * 5000, { routerMs: null, internetMs: null }));
    expect(tracker.reading("x").state).toBe("no-internet");
  });

  it("takes the worse loss of the router and the internet, over the last 100 pings", () => {
    const tracker = new ConnectionTracker([]);
    for (let i = 0; i < 100; i++) tracker.feed(lookAt(i * 5000, i % 10 === 5 ? { routerMs: null } : {}));
    expect(tracker.reading("x").lossPercent).toBe(10);
    // Old losses fall out of the window.
    for (let i = 100; i < 200; i++) tracker.feed(lookAt(i * 5000));
    expect(tracker.reading("x").lossPercent).toBe(0);
  });

  it("stops a drop that goes on when the watching stops", () => {
    const tracker = new ConnectionTracker([]);
    tracker.feed(lookAt(0));
    for (let i = 1; i <= 3; i++) tracker.feed(lookAt(i * 5000, { internetMs: null }));
    tracker.close(30000);
    expect(tracker.outages).toEqual([{ start: 5000, end: 30000, kind: "no-internet" }]);
    expect(tracker.reading("x").state).toBe("online");
  });
});

describe("the log", () => {
  it("drops entries older than 30 days and keeps the open one", () => {
    const now = 100 * DAY;
    const outages: StoredOutage[] = [
      { start: now - 40 * DAY, end: now - 40 * DAY + 1000, kind: "offline" },
      { start: now - (LOG_DAYS * DAY + 10), end: now - (LOG_DAYS * DAY + 5), kind: "offline" },
      { start: now - 5 * DAY, end: now - 5 * DAY + 1000, kind: "no-router" },
      { start: now - 100, end: null, kind: "no-internet" },
    ];
    expect(prune(outages, now).map((outage) => outage.kind)).toEqual(["no-router", "no-internet"]);
  });

  it("is read carefully, and a drop left open ended when the file was last written", () => {
    const stored = sanitizeStored({
      enabled: false,
      target: "Example.COM",
      savedAt: 9000,
      outages: [{ start: 8000, end: null, kind: "offline" }, { start: "x" }, { start: 1, end: 2, kind: "weird" }, { start: 100, end: 200, kind: "no-router" }, null],
    });
    expect(stored).toEqual({
      enabled: false,
      target: "example.com",
      savedAt: 9000,
      outages: [
        { start: 100, end: 200, kind: "no-router" },
        { start: 8000, end: 9000, kind: "offline" },
      ],
    });
    expect(sanitizeStored("nonsense")).toEqual(DEFAULT_STORED);
    expect(sanitizeStored({ target: "not valid!" }).target).toBe("1.1.1.1");
  });
});

describe("addresses and settings", () => {
  it("accepts IPv4 addresses and names, and refuses the rest", () => {
    expect(parseConnectionTarget(" 8.8.8.8 ")).toBe("8.8.8.8");
    expect(parseConnectionTarget("Example.com.")).toBe("example.com");
    for (const bad of ["", "http://example.com", "example.com/path", "example.com:80", "300.1.1.1", "1.1.1", "0.0.0.0", "239.1.1.1", "::1", "a b", "-x.com", 5, null]) {
      expect(() => parseConnectionTarget(bad), String(bad)).toThrow();
    }
  });

  it("refuses everything on this PC or the local network", () => {
    const local = [
      "127.0.0.1", "10.0.0.5", "192.168.178.1", "172.16.0.1", "169.254.1.1", "100.64.0.1", "192.0.2.55", "255.255.255.255",
      "router", "localhost", "nas", "printer.local", "box.lan", "x.home.arpa", "host.internal", "fritz.box", "speedport.ip", "router.asus.com",
    ];
    for (const bad of local) expect(() => parseConnectionTarget(bad), bad).toThrow(/public/);
    for (const good of ["1.1.1.1", "9.9.9.9", "example.com", "dns.google"]) expect(parseConnectionTarget(good)).toBe(good);
  });

  it("checks the settings call strictly", () => {
    expect(parseConnectionSettings({})).toEqual({});
    expect(parseConnectionSettings({ enabled: false, target: "1.0.0.1" })).toEqual({ enabled: false, target: "1.0.0.1" });
    expect(() => parseConnectionSettings({ enabled: "yes" })).toThrow();
    expect(() => parseConnectionSettings({ other: 1 })).toThrow();
    expect(() => parseConnectionSettings([])).toThrow();
  });

  it("lets a panel watch the connection alone", () => {
    expect(parseWatch({ blocks: { connection: true }, intervalMs: 1000 }).blocks.connection).toBe(true);
    expect(() => parseWatch({ blocks: { connection: 1 }, intervalMs: 1000 })).toThrow();
  });
});

// ── The watcher ──────────────────────────────────────────────────────

class FakeProbe implements ConnectionProbe {
  network: LocalNetwork = { windowsOffline: false, gateway: "192.168.1.1", adapter: { index: 3, bytesIn: 0, bytesOut: 0 } };
  /** The answers by address; a missing one is lost. */
  answers = new Map<string, number>([["192.168.1.1", 2], ["1.1.1.1", 14]]);
  names = new Map<string, string>([["example.com", "93.184.216.34"]]);
  pings: { channel: string; address: string }[] = [];
  resolves: string[] = [];
  closed = 0;
  local(): LocalNetwork {
    return this.network;
  }
  async ping(channel: "router" | "internet", address: string): Promise<number | null> {
    this.pings.push({ channel, address });
    return this.answers.get(address) ?? null;
  }
  async resolve(name: string): Promise<string | null> {
    this.resolves.push(name);
    return this.names.get(name) ?? null;
  }
  close(): void {
    this.closed++;
  }
}

class FakeStore implements ConnectionStore {
  saved: StoredConnection[] = [];
  immediate: StoredConnection[] = [];
  save(data: StoredConnection): void {
    this.saved.push(data);
  }
  saveNow(data: StoredConnection): void {
    this.immediate.push(data);
  }
  get last(): StoredConnection {
    return this.saved.at(-1)!;
  }
}

describe("ConnectionWatcher", () => {
  let probe: FakeProbe;
  let store: FakeStore;
  let watcher: ConnectionWatcher;
  let changes: SystemConnection[];

  const make = (initial: StoredConnection = DEFAULT_STORED) => {
    began = false;
    watcher = new ConnectionWatcher({ probe, store, initial: { ...initial, outages: [...initial.outages] }, now: () => Date.now() });
    watcher.onChange((reading) => changes.push(reading));
  };
  /** Runs the first look, and then `count - 1` more at 5 seconds each. */
  let began = false;
  const looks = async (count: number) => {
    if (!began) {
      began = true;
      await vi.advanceTimersByTimeAsync(0);
      count--;
    }
    for (let i = 0; i < count; i++) await vi.advanceTimersByTimeAsync(CONNECTION_TICK_MS);
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    probe = new FakeProbe();
    store = new FakeStore();
    changes = [];
    began = false;
    make();
  });
  afterEach(() => {
    watcher.dispose();
    vi.useRealTimers();
  });

  it("does nothing until the host says the module is there", async () => {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probe.pings).toEqual([]);
    expect(watcher.running).toBe(false);
    expect(watcher.read().state).toBe("off");
  });

  it("pings the router and the address every 5 seconds, once each", async () => {
    watcher.setActive(true);
    await looks(3);
    expect(probe.pings.filter((ping) => ping.channel === "router")).toHaveLength(3);
    expect(probe.pings.filter((ping) => ping.channel === "internet").every((ping) => ping.address === "1.1.1.1")).toBe(true);
    expect(watcher.read()).toMatchObject({ state: "online", routerMs: 2, internetMs: 14, lossPercent: 0, target: "1.1.1.1" });
  });

  it("logs a drop that begins after 3 lost pings and ends when they come back, and tells the panels", async () => {
    watcher.setActive(true);
    await looks(2);
    probe.answers.delete("1.1.1.1");
    await looks(3);
    expect(watcher.read().state).toBe("no-internet");
    expect(changes.map((reading) => reading.state)).toEqual(["no-internet"]);
    expect(watcher.outageLog().outages).toHaveLength(1);
    expect(watcher.outageLog().outages[0]).toMatchObject({ kind: "no-internet", end: null });
    expect(store.last.outages).toHaveLength(1);
    probe.answers.set("1.1.1.1", 15);
    await looks(2);
    expect(changes.map((reading) => reading.state)).toEqual(["no-internet", "online"]);
    const [outage] = watcher.outageLog().outages;
    expect(outage!.end).not.toBeNull();
    expect(outage!.durationMs).toBe(outage!.end! - outage!.start);
    expect(store.last.outages[0]!.end).toBe(outage!.end);
  });

  it("says the router when it goes too, and the router's missing answer is not a single loss", async () => {
    watcher.setActive(true);
    await looks(2);
    probe.answers.clear();
    await looks(3);
    expect(watcher.read().state).toBe("no-router");
  });

  it("goes down at once when Windows says offline", async () => {
    watcher.setActive(true);
    await looks(1);
    probe.network = { windowsOffline: true, gateway: null, adapter: null };
    probe.answers.clear();
    await looks(2);
    expect(watcher.read().state).toBe("offline");
  });

  it("measures the speed through the adapter in megabits per second", async () => {
    watcher.setActive(true);
    await looks(1);
    expect(watcher.read().downMbit).toBeNull();
    probe.network = { ...probe.network, adapter: { index: 3, bytesIn: 6_250_000, bytesOut: 625_000 } };
    await looks(1);
    // 6.25 MB in 5 seconds is 10 megabits per second; 0.625 MB is 1.
    expect(watcher.read()).toMatchObject({ downMbit: 10, upMbit: 1 });
    // Another adapter, or counters that started over, give no speed.
    probe.network = { ...probe.network, adapter: { index: 4, bytesIn: 10, bytesOut: 10 } };
    await looks(1);
    expect(watcher.read()).toMatchObject({ downMbit: null, upMbit: null });
  });

  it("resolves a name once and pings its address, and keeps the address when a ping is lost", async () => {
    watcher.setActive(true);
    watcher.setSettings({ target: "example.com" });
    probe.answers.set("93.184.216.34", 20);
    await looks(3);
    probe.answers.delete("93.184.216.34");
    await looks(4);
    expect(probe.resolves).toEqual(["example.com"]);
    expect(probe.pings.some((ping) => ping.address === "93.184.216.34")).toBe(true);
    expect(watcher.getSettings().target).toBe("example.com");
    expect(store.last.target).toBe("example.com");
  });

  it("counts a name that can't be found as a lost ping", async () => {
    watcher.setActive(true);
    watcher.setSettings({ target: "nowhere.example" });
    await looks(4);
    expect(watcher.read().state).toBe("no-internet");
  });

  it("never pings a name that comes out on this PC or the local network: it counts as lost", async () => {
    probe.names.set("evil.example.com", "192.168.178.1");
    watcher.setActive(true);
    watcher.setSettings({ target: "evil.example.com" });
    await looks(4);
    expect(probe.pings.filter((ping) => ping.channel === "internet")).toEqual([]);
    expect(probe.resolves).toEqual(["evil.example.com"]);
    expect(watcher.read().state).toBe("no-internet");
  });

  it("asks again for a name that was not found after a while, not every look", async () => {
    watcher.setActive(true);
    watcher.setSettings({ target: "nowhere.example.com" });
    await looks(5);
    expect(probe.resolves).toHaveLength(1);
    await looks(2);
    expect(probe.resolves).toHaveLength(2);
  });

  it("waits for the normal look after a new address: no extra ping", async () => {
    watcher.setActive(true);
    await looks(2);
    const before = probe.pings.length;
    await vi.advanceTimersByTimeAsync(SETTINGS_EVERY_MS);
    const during = probe.pings.length;
    watcher.setSettings({ target: "8.8.8.8" });
    await vi.advanceTimersByTimeAsync(10);
    expect(probe.pings).toHaveLength(during);
    expect(before).toBeLessThan(during);
    await vi.advanceTimersByTimeAsync(CONNECTION_TICK_MS);
    expect(probe.pings.some((ping) => ping.address === "8.8.8.8")).toBe(true);
  });

  it("changes its settings at most once every 5 seconds", async () => {
    watcher.setActive(true);
    await looks(1);
    watcher.setSettings({ target: "8.8.8.8" });
    expect(() => watcher.setSettings({ target: "9.9.9.9" })).toThrow(/just changed/);
    expect(() => watcher.setSettings({ enabled: false })).toThrow(/just changed/);
    // Saying what already is costs nothing.
    expect(watcher.setSettings({ target: "8.8.8.8" })).toEqual({ enabled: true, target: "8.8.8.8" });
    await vi.advanceTimersByTimeAsync(SETTINGS_EVERY_MS);
    expect(watcher.setSettings({ target: "9.9.9.9" })).toEqual({ enabled: true, target: "9.9.9.9" });
  });

  it("writes a drop that goes on once a minute", async () => {
    watcher.setActive(true);
    await looks(1);
    probe.answers.clear();
    await looks(4);
    const saved = store.saved.length;
    await looks(12);
    expect(store.saved.length).toBeGreaterThan(saved);
    expect(store.saved.at(-1)!.outages.at(-1)!.end).toBeNull();
    // A drop that is over is not written again and again.
    probe.answers.set("1.1.1.1", 10);
    await looks(2);
    const after = store.saved.length;
    await looks(30);
    expect(store.saved).toHaveLength(after);
  });

  it("stops when switched off and starts again when switched on", async () => {
    watcher.setActive(true);
    await looks(2);
    const before = probe.pings.length;
    expect(watcher.setSettings({ enabled: false })).toEqual({ enabled: false, target: "1.1.1.1" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(probe.pings).toHaveLength(before);
    expect(watcher.running).toBe(false);
    expect(watcher.read().state).toBe("off");
    expect(changes.at(-1)!.state).toBe("off");
    await vi.advanceTimersByTimeAsync(SETTINGS_EVERY_MS);
    watcher.setSettings({ enabled: true });
    await looks(1);
    expect(probe.pings.length).toBeGreaterThan(before);
    expect(watcher.read().state).toBe("online");
  });

  it("closes a drop that goes on when the module goes away", async () => {
    watcher.setActive(true);
    await looks(1);
    probe.answers.clear();
    await looks(4);
    expect(watcher.outageLog().outages[0]!.end).toBeNull();
    watcher.setActive(false);
    expect(watcher.outageLog().outages[0]!.end).not.toBeNull();
    expect(store.last.outages[0]!.end).not.toBeNull();
  });

  it("clears the log but keeps a drop that is still going on", async () => {
    make({ ...DEFAULT_STORED, outages: [{ start: 500_000, end: 600_000, kind: "offline" }] });
    expect(watcher.outageLog().outages).toHaveLength(1);
    watcher.setActive(true);
    await looks(1);
    probe.answers.clear();
    await looks(4);
    expect(watcher.outageLog().outages).toHaveLength(2);
    watcher.clearLog();
    expect(watcher.outageLog().outages).toHaveLength(1);
    expect(watcher.outageLog().outages[0]!.end).toBeNull();
    probe.answers.set("1.1.1.1", 10);
    await looks(2);
    watcher.clearLog();
    expect(watcher.outageLog().outages).toEqual([]);
    expect(store.last.outages).toEqual([]);
  });

  it("prunes drops older than 30 days when it writes", async () => {
    const now = Date.now();
    make({ ...DEFAULT_STORED, outages: [{ start: now - 40 * DAY, end: now - 40 * DAY + 5000, kind: "offline" }, { start: now - DAY, end: now - DAY + 5000, kind: "no-router" }] });
    expect(watcher.outageLog().outages.map((outage) => outage.kind)).toEqual(["no-router"]);
    watcher.setSettings({ target: "8.8.8.8" });
    expect(store.last.outages.map((outage) => outage.kind)).toEqual(["no-router"]);
  });

  it("writes the log at once when Tavora quits", () => {
    watcher.setActive(true);
    watcher.dispose();
    expect(store.immediate).toHaveLength(1);
    expect(probe.closed).toBe(1);
  });

  it("lists the newest drop first, with the time it lasted so far", async () => {
    const now = Date.now();
    make({ ...DEFAULT_STORED, outages: [{ start: now - 5000, end: now - 4000, kind: "offline" }, { start: now - 3000, end: null, kind: "no-router" }] });
    // A drop left open is closed when read from a file (sanitizeStored); here it is going on.
    expect(watcher.outageLog().outages).toEqual([
      { start: now - 3000, end: null, kind: "no-router", durationMs: 3000 },
      { start: now - 5000, end: now - 4000, kind: "offline", durationMs: 1000 },
    ]);
  });
});

describe("who may change the watcher", () => {
  const settings = { enabled: true, target: "1.1.1.1" };
  function access(owner = "official", id = "tavora.system-monitor", gesture: (what: string) => Promise<void> = async () => undefined) {
    const calls: string[] = [];
    const watcher = {
      outageLog: () => ({ outages: [] }),
      getSettings: () => settings,
      clearLog: () => void calls.push("clear"),
      setSettings: (change: object) => (calls.push(`set ${JSON.stringify(change)}`), { ...settings, ...change }),
    };
    return { calls, api: connectionAccess({ owner, manifest: { id } }, watcher, gesture) };
  }

  it("lets any granted module read the log and the settings", () => {
    const { api } = access("local", "local.other");
    expect(api.connectionLog()).toEqual({ outages: [] });
    expect(api.connectionSettings()).toEqual(settings);
  });

  it("refuses every other module the changes, even with a click", async () => {
    for (const [owner, id] of [["local", "local.other"], ["official", "tavora.notes"], ["local", "tavora.system-monitor"], ["a".repeat(64), "tavora.system-monitor"]] as const) {
      const { api, calls } = access(owner, id);
      await expect(api.setConnectionSettings({ target: "8.8.8.8" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await expect(api.clearConnectionLog()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(calls).toEqual([]);
    }
  });

  it("refuses the System Monitor too without a click or key press", async () => {
    const noClick = async (what: string) => {
      throw new HostError("PERMISSION_DENIED", `${what} must be called right after a click or key press`);
    };
    const { api, calls } = access("official", "tavora.system-monitor", noClick);
    await expect(api.setConnectionSettings({ enabled: false })).rejects.toThrow(/click or key press/);
    await expect(api.clearConnectionLog()).rejects.toThrow(/click or key press/);
    expect(calls).toEqual([]);
  });

  it("does what the System Monitor asks after a click", async () => {
    const asked: string[] = [];
    const { api, calls } = access("official", "tavora.system-monitor", async (what) => void asked.push(what));
    await expect(api.setConnectionSettings({ target: "8.8.8.8" })).resolves.toEqual({ enabled: true, target: "8.8.8.8" });
    await api.clearConnectionLog();
    expect(calls).toEqual(['set {"target":"8.8.8.8"}', "clear"]);
    expect(asked).toEqual(["systemInfo.setConnectionSettings", "systemInfo.clearConnectionLog"]);
  });
});
