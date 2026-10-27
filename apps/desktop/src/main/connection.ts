/**
 * The connection watcher of the system-info connector: is this PC online, how fast do the router and one address on
 * the internet answer, how many pings get lost, how much goes through the network adapter, and a log of the drops.
 *
 * It runs inside Tavora, apart from any panel, while the System Monitor module is in a workspace and has its
 * grant (host.ts decides with `setActive`), so drops are logged even when no panel is shown. One timer looks every
 * 5 seconds: two pings (ICMP, from iphlpapi.dll, never blocking the main thread), one question to Windows whether it
 * thinks it is online, and one read of the adapter's byte counters. What a look finds goes through the ConnectionTracker
 * (pure, tested with fakes). Nothing is run and nothing is sent but the two pings.
 */
import { SYSTEM_PING_TARGET, type SystemConnection, type SystemConnectionLog, type SystemConnectionSettings, type SystemOutage, type SystemOutageKind } from "@tavora/sdk/protocol";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HostError } from "./errors";
import { readJsonOrSetAside } from "./json";
import { writeFileAtomic } from "./fsutil";
import { isPublicAddress } from "./network";
import { parseConnectionTarget, parseIpv4, type ConnectionSettingsChange } from "./system-info-parse";

/** Time between two looks. */
export const CONNECTION_TICK_MS = 5000;
/** How long a ping waits for its answer. */
export const PING_TIMEOUT_MS = 1000;
/** Lost pings in a row that make a drop. */
export const LOST_IN_A_ROW = 3;
/** The pings the loss percentage counts. */
export const LOSS_WINDOW = 100;
/** How long the log keeps a drop. */
export const LOG_DAYS = 30;
/** The most drops kept, the oldest go first. */
const MAX_OUTAGES = 500;
/** An address found for a name is used this long before asking again. */
const RESOLVE_TTL_MS = 5 * 60 * 1000;
/** A name that could not be found, or came out on this PC or the local network, is asked again after this long. */
const RESOLVE_RETRY_MS = 30 * 1000;
/** The watcher's settings change at most this often, so a page can't make Tavora switch targets or restart it in a loop. */
export const SETTINGS_EVERY_MS = CONNECTION_TICK_MS;
/** A drop that goes on is written this often, so a crash does not record it as a few seconds long. */
const SAVE_OPEN_EVERY_MS = 60 * 1000;

/** What one look at the local network found. */
export interface LocalNetwork {
  /** Windows says there is no network at all (not "no internet": that is for the pings to find out). */
  windowsOffline: boolean;
  /** The router: the next hop on the way to the internet, or null when there is none. */
  gateway: string | null;
  /** The adapter that way, with the bytes it has received and sent since it came up; null when unknown. */
  adapter: { index: number; bytesIn: number; bytesOut: number } | null;
}

/** What the watcher needs from the PC. Throws are caught by the watcher, which then reports less. */
export interface ConnectionProbe {
  /** Cheap and at once. */
  local(): LocalNetwork;
  /** One echo to an IPv4 address: the milliseconds it took, or null when it was lost. Never rejects, never blocks the main thread. */
  ping(channel: "router" | "internet", address: string, timeoutMs: number): Promise<number | null>;
  /** The IPv4 address of a name, or null. Never rejects. */
  resolve(name: string): Promise<string | null>;
  close(): void;
}

/** A drop as kept in the file. */
export interface StoredOutage {
  start: number;
  /** Null while it goes on. */
  end: number | null;
  kind: SystemOutageKind;
}

/** What is kept in connection.json. */
export interface StoredConnection extends SystemConnectionSettings {
  outages: StoredOutage[];
  /** When it was last written; a drop still open then ended at that time. */
  savedAt: number;
}

export const DEFAULT_STORED: StoredConnection = { enabled: true, target: SYSTEM_PING_TARGET, outages: [], savedAt: 0 };

const KINDS: readonly SystemOutageKind[] = ["offline", "no-router", "no-internet"];

/** Reads connection.json's content, keeping only what is well formed. A drop left open ended when the file was last written. */
export function sanitizeStored(raw: unknown): StoredConnection {
  const stored: StoredConnection = { ...DEFAULT_STORED, outages: [] };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return stored;
  const record = raw as Record<string, unknown>;
  if (typeof record.enabled === "boolean") stored.enabled = record.enabled;
  if (typeof record.target === "string") {
    try {
      stored.target = parseConnectionTarget(record.target);
    } catch {
      // The default stays.
    }
  }
  if (typeof record.savedAt === "number" && Number.isFinite(record.savedAt)) stored.savedAt = record.savedAt;
  if (Array.isArray(record.outages)) {
    for (const item of record.outages) {
      if (typeof item !== "object" || item === null) continue;
      const { start, end, kind } = item as Record<string, unknown>;
      if (typeof start !== "number" || !Number.isFinite(start) || !KINDS.includes(kind as SystemOutageKind)) continue;
      const ended = typeof end === "number" && Number.isFinite(end) ? Math.max(start, end) : Math.max(start, stored.savedAt);
      stored.outages.push({ start, end: ended, kind: kind as SystemOutageKind });
    }
    stored.outages.sort((a, b) => a.start - b.start);
  }
  return stored;
}

/** Where the settings and the log live. */
export interface ConnectionStore {
  save(data: StoredConnection): void;
  /** Writes at once, for the moment Tavora quits. */
  saveNow?(data: StoredConnection): void;
}

/** connection.json in the data folder, written in order, never half. */
export class ConnectionFile implements ConnectionStore {
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load(): Promise<StoredConnection> {
    return sanitizeStored(await readJsonOrSetAside<unknown>(this.file).catch(() => null));
  }

  save(data: StoredConnection): void {
    const body = `${JSON.stringify({ version: 1, ...data }, null, 2)}\n`;
    this.writing = this.writing.then(() => writeFileAtomic(this.file, body)).catch(() => undefined);
  }

  saveNow(data: StoredConnection): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.now`, `${JSON.stringify({ version: 1, ...data }, null, 2)}\n`);
      renameSync(`${this.file}.now`, this.file);
    } catch {
      // The log of this run may be lost; nothing else depends on it.
    }
  }

  /** Resolves when everything saved so far is written. */
  flush(): Promise<void> {
    return this.writing;
  }
}

/** One look's findings, for the tracker. */
export interface ConnectionSample {
  at: number;
  windowsOffline: boolean;
  routerFound: boolean;
  /** Null when the ping was lost. */
  routerMs: number | null;
  internetMs: number | null;
  downMbit: number | null;
  upMbit: number | null;
}

/** How bad a kind of drop is; a drop only gets worse. */
const RANK: Record<"online" | SystemOutageKind, number> = { online: 0, "no-internet": 1, "no-router": 2, offline: 3 };

const round = (value: number, digits: number): number => Math.round(value * 10 ** digits) / 10 ** digits;

/** The last pings as lost or not, for the loss percentage. */
class LossWindow {
  private readonly lost: boolean[] = [];
  private count = 0;

  push(lost: boolean): void {
    this.lost.push(lost);
    if (lost) this.count++;
    if (this.lost.length > LOSS_WINDOW && this.lost.shift()) this.count--;
  }

  clear(): void {
    this.lost.length = 0;
    this.count = 0;
  }

  percent(): number {
    return this.lost.length === 0 ? 0 : round((this.count / this.lost.length) * 100, 1);
  }
}

/**
 * The rules, without any PC in them. A drop is when Windows says there is no network or 3 pings to the internet are lost
 * in a row; it ends with the first answer. Single losses only count towards the loss percentage. The kind of a drop:
 * "offline" when Windows says there is no network; "no-router" when the router answered before and has lost 3 pings
 * in a row; else "no-internet" (the router answers, or is unknown, or never answers pings, which some do not). A drop
 * keeps the worst kind it had (no-internet, then no-router, then offline), so it never flip-flops.
 */
export class ConnectionTracker {
  private routerLost = 0;
  private internetLost = 0;
  private internetLostSince = 0;
  private routerSeen = false;
  private readonly routerWindow = new LossWindow();
  private readonly internetWindow = new LossWindow();
  private last: ConnectionSample | null = null;
  private state: SystemConnection["state"] = "online";
  private since: number | null = null;
  /** Oldest first; the one still going on, if any, is last and has no `end`. */
  readonly outages: StoredOutage[];

  constructor(outages: StoredOutage[]) {
    this.outages = outages;
  }

  /** Takes one look in. Returns whether the state changed: a drop began, ended or changed its kind. */
  feed(sample: ConnectionSample): { changed: boolean } {
    if (sample.routerFound) {
      if (sample.routerMs !== null) this.routerSeen = true;
      this.routerLost = sample.routerMs === null ? this.routerLost + 1 : 0;
      if (this.routerSeen) this.routerWindow.push(sample.routerMs === null);
    } else {
      this.routerLost = 0;
      this.routerSeen = false;
    }
    if (sample.internetMs === null) {
      if (this.internetLost === 0) this.internetLostSince = sample.at;
      this.internetLost++;
    } else {
      this.internetLost = 0;
    }
    this.internetWindow.push(sample.internetMs === null);
    this.last = sample;

    const next = this.stateNow(sample);
    const before = this.state;
    const open = this.outages.at(-1)?.end === null ? this.outages.at(-1)! : null;
    if (next === "online") {
      if (open) open.end = sample.at;
      this.since = null;
    } else if (open) {
      if (RANK[next] > RANK[open.kind]) open.kind = next;
      this.since = open.start;
    } else {
      const start = sample.windowsOffline ? sample.at : Math.min(sample.at, this.internetLostSince);
      this.outages.push({ start, end: null, kind: next });
      this.since = start;
    }
    const after = open && next !== "online" ? open.kind : next;
    this.state = after;
    return { changed: after !== before };
  }

  private stateNow(sample: ConnectionSample): "online" | SystemOutageKind {
    if (sample.windowsOffline) return "offline";
    if (this.internetLost < LOST_IN_A_ROW) return "online";
    return sample.routerFound && this.routerSeen && this.routerLost >= LOST_IN_A_ROW ? "no-router" : "no-internet";
  }

  /** Closes a drop that goes on, as when the watching stops. */
  close(at: number): void {
    const open = this.outages.at(-1);
    if (open && open.end === null) open.end = Math.max(open.start, at);
    this.reset();
  }

  /** Forgets what the pings said so far (the log stays). */
  reset(): void {
    this.routerLost = 0;
    this.internetLost = 0;
    this.routerSeen = false;
    this.routerWindow.clear();
    this.internetWindow.clear();
    this.last = null;
    this.state = "online";
    this.since = null;
  }

  /** The worse of the router's and the internet's loss; the router counts once it has answered at all. */
  lossPercent(): number {
    return Math.max(this.internetWindow.percent(), this.routerSeen ? this.routerWindow.percent() : 0);
  }

  reading(target: string): SystemConnection {
    const last = this.last;
    return {
      state: this.state,
      routerMs: last?.routerMs ?? null,
      internetMs: last?.internetMs ?? null,
      routerFound: last?.routerFound ?? false,
      lossPercent: this.lossPercent(),
      downMbit: last?.downMbit ?? null,
      upMbit: last?.upMbit ?? null,
      target,
      since: this.since,
    };
  }
}

/** Drops older than the log keeps, and the oldest beyond the cap, are removed. */
export function prune(outages: StoredOutage[], now: number): StoredOutage[] {
  const oldest = now - LOG_DAYS * 24 * 60 * 60 * 1000;
  const kept = outages.filter((outage) => outage.end === null || outage.end >= oldest);
  return kept.slice(-MAX_OUTAGES);
}

/** What the SystemMonitor needs: the newest reading, and to hear of changes. */
export interface ConnectionSource {
  read(): SystemConnection;
  onChange(listener: (connection: SystemConnection) => void): () => void;
}

export interface ConnectionWatcherOptions {
  probe: ConnectionProbe;
  store: ConnectionStore;
  initial: StoredConnection;
  /** For tests. */
  now?: () => number;
  /** For problems; the watcher never throws out of a timer. */
  log?: (message: string, error: unknown) => void;
}

/** The id of the one module that may change the watcher: Tavora's own System Monitor. */
export const SYSTEM_MONITOR_ID = "tavora.system-monitor";

/**
 * What a module granted System info gets of the watcher. Everyone granted may read the log and the settings. Changing
 * the settings (where Tavora pings, whether it watches) and clearing the log affect the whole PC, so they are only for
 * the official System Monitor, and each needs a click or key press in its page (`gesture` waits for it and throws
 * without one), as Discord's sign-in does.
 */
export function connectionAccess(
  module: { owner: string; manifest: { id: string } },
  watcher: Pick<ConnectionWatcher, "outageLog" | "clearLog" | "getSettings" | "setSettings">,
  gesture: (what: string) => Promise<void>,
) {
  const official = (what: string): void => {
    if (module.owner !== "official" || module.manifest.id !== SYSTEM_MONITOR_ID) throw new HostError("PERMISSION_DENIED", `${what} is only for Tavora's own System Monitor`);
  };
  return {
    connectionLog: () => watcher.outageLog(),
    connectionSettings: () => watcher.getSettings(),
    clearConnectionLog: async (): Promise<void> => {
      official("systemInfo.clearConnectionLog");
      await gesture("systemInfo.clearConnectionLog");
      watcher.clearLog();
    },
    setConnectionSettings: async (change: ConnectionSettingsChange): Promise<SystemConnectionSettings> => {
      official("systemInfo.setConnectionSettings");
      await gesture("systemInfo.setConnectionSettings");
      return watcher.setSettings(change);
    },
  };
}

export class ConnectionWatcher implements ConnectionSource {
  private readonly probe: ConnectionProbe;
  private readonly store: ConnectionStore;
  private readonly now: () => number;
  private readonly log: (message: string, error: unknown) => void;
  private readonly tracker: ConnectionTracker;
  private readonly listeners = new Set<(connection: SystemConnection) => void>();
  private settings: SystemConnectionSettings;
  private active = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private first: ReturnType<typeof setImmediate> | null = null;
  private busy = false;
  /** Raised whenever the watching stops or its address changes, so a look still under way is dropped. */
  private generation = 0;
  /** What the last lookup of the chosen name gave: an address, or null when it was not found or not a public one. */
  private resolved: { name: string; ip: string | null; at: number } | null = null;
  private changedAt = -Infinity;
  private savedAt = 0;
  private readonly warned = new Set<string>();
  private previous: { index: number; bytesIn: number; bytesOut: number; at: number } | null = null;

  constructor(options: ConnectionWatcherOptions) {
    this.probe = options.probe;
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
    this.settings = { enabled: options.initial.enabled, target: options.initial.target };
    this.tracker = new ConnectionTracker(prune([...options.initial.outages], this.now()));
  }

  /** Whether the timer runs: wanted by the host and not switched off by the player. */
  get running(): boolean {
    return this.timer !== null || this.first !== null;
  }

  /** The host says whether the System Monitor module is in a workspace with its grant. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.refresh();
  }

  getSettings(): SystemConnectionSettings {
    return { ...this.settings };
  }

  /** At most one change every 5 seconds; a change that changes nothing is free. */
  setSettings(change: ConnectionSettingsChange): SystemConnectionSettings {
    const targetChanged = change.target !== undefined && change.target !== this.settings.target;
    const enabledChanged = change.enabled !== undefined && change.enabled !== this.settings.enabled;
    if (!targetChanged && !enabledChanged) return this.getSettings();
    const now = this.now();
    if (now - this.changedAt < SETTINGS_EVERY_MS) throw new HostError("QUOTA_EXCEEDED", "The connection settings were just changed; try again in a few seconds");
    this.changedAt = now;
    if (change.enabled !== undefined) this.settings.enabled = change.enabled;
    if (change.target !== undefined) this.settings.target = change.target;
    if (targetChanged) {
      // The old address' readings mean nothing for the new one.
      this.resolved = null;
      this.generation++;
      this.tracker.close(this.now());
    }
    this.persist();
    // A new address waits for the next look in turn: no extra ping now.
    this.refresh();
    if (targetChanged) this.announce();
    return this.getSettings();
  }

  read(): SystemConnection {
    return this.running ? this.tracker.reading(this.settings.target) : this.off();
  }

  onChange(listener: (connection: SystemConnection) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The drops of the last 30 days, the newest first. */
  outageLog(): SystemConnectionLog {
    const now = this.now();
    const outages: SystemOutage[] = prune(this.tracker.outages, now)
      .map((outage) => ({ start: outage.start, end: outage.end, kind: outage.kind, durationMs: Math.max(0, (outage.end ?? now) - outage.start) }))
      .reverse();
    return { outages };
  }

  /** Empties the log; a drop that goes on is kept (it is still happening). */
  clearLog(): void {
    const open = this.tracker.outages.at(-1)?.end === null ? this.tracker.outages.at(-1)! : null;
    this.tracker.outages.length = 0;
    if (open) this.tracker.outages.push(open);
    this.persist();
  }

  /** Stops everything and writes the log once more. */
  dispose(): void {
    this.stop();
    this.persist(true);
    this.listeners.clear();
    this.probe.close();
  }

  private off(): SystemConnection {
    return { state: "off", routerMs: null, internetMs: null, routerFound: false, lossPercent: 0, downMbit: null, upMbit: null, target: this.settings.target, since: null };
  }

  private refresh(): void {
    const wanted = this.active && this.settings.enabled;
    if (wanted && !this.running) {
      this.timer = setInterval(() => void this.tick(), CONNECTION_TICK_MS);
      this.timer.unref?.();
      // The first look soon, not after 5 seconds.
      this.first = setImmediate(() => {
        this.first = null;
        void this.tick();
      });
    } else if (!wanted && this.running) {
      this.stop();
      this.persist();
      this.announce();
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    if (this.first !== null) clearImmediate(this.first);
    this.timer = null;
    this.first = null;
  }

  private stop(): void {
    this.stopTimer();
    this.generation++;
    this.tracker.close(this.now());
    this.previous = null;
  }

  private persist(immediately = false): void {
    const stamp = this.now();
    this.savedAt = stamp;
    this.tracker.outages.splice(0, this.tracker.outages.length, ...prune(this.tracker.outages, stamp));
    try {
      const data = { ...this.settings, outages: this.tracker.outages.map((outage) => ({ ...outage })), savedAt: stamp };
      if (immediately && this.store.saveNow) this.store.saveNow(data);
      else this.store.save(data);
    } catch (error) {
      this.log("connection: could not save the log", error);
    }
  }

  /** Each problem is told once, not every 5 seconds. */
  private warnOnce(message: string, error: unknown): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.log(message, error);
  }

  private announce(): void {
    const reading = this.read();
    for (const listener of [...this.listeners]) {
      try {
        listener(reading);
      } catch (error) {
        this.log("connection: a panel could not be told", error);
      }
    }
  }

  /** The IPv4 address to ping for the chosen target; null when a name can't be found. */
  private async addressOf(target: string): Promise<string | null> {
    if (parseIpv4(target)) return target;
    const known = this.resolved;
    if (known && known.name === target && this.now() - known.at < (known.ip ? RESOLVE_TTL_MS : RESOLVE_RETRY_MS)) return known.ip;
    const found = await this.probe.resolve(target);
    // A name that comes out on this PC or the local network is never pinged: it counts as lost.
    const ip = found && isPublicAddress(found) ? found : null;
    this.resolved = { name: target, ip, at: this.now() };
    return ip;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const generation = this.generation;
    try {
      const at = this.now();
      let local: LocalNetwork = { windowsOffline: false, gateway: null, adapter: null };
      try {
        local = this.probe.local();
      } catch (error) {
        this.warnOnce("connection: could not look at the network", error);
      }
      const target = this.settings.target;
      const address = await this.addressOf(target);
      const [routerMs, internetMs] = await Promise.all([
        local.gateway ? this.probe.ping("router", local.gateway, PING_TIMEOUT_MS) : Promise.resolve(null),
        address ? this.probe.ping("internet", address, PING_TIMEOUT_MS) : Promise.resolve(null),
      ]);
      // The watching stopped or changed its address while the pings were out.
      if (generation !== this.generation) return;
      const speed = this.speed(local, at);
      const { changed } = this.tracker.feed({
        at,
        windowsOffline: local.windowsOffline,
        routerFound: local.gateway !== null,
        routerMs,
        internetMs,
        downMbit: speed?.down ?? null,
        upMbit: speed?.up ?? null,
      });
      if (changed) {
        this.persist();
        this.announce();
      } else if (this.tracker.outages.at(-1)?.end === null && at - this.savedAt >= SAVE_OPEN_EVERY_MS) {
        this.persist();
      }
    } catch (error) {
      this.log("connection: a look failed", error);
    } finally {
      this.busy = false;
    }
  }

  /** Megabits per second through the adapter since the last look; null for the first look, another adapter or a counter that started over. */
  private speed(local: LocalNetwork, at: number): { down: number; up: number } | null {
    const adapter = local.adapter;
    const before = this.previous;
    this.previous = adapter ? { ...adapter, at } : null;
    if (!adapter || !before || before.index !== adapter.index || at <= before.at) return null;
    if (adapter.bytesIn < before.bytesIn || adapter.bytesOut < before.bytesOut) return null;
    const seconds = (at - before.at) / 1000;
    const mbit = (bytes: number) => round(((bytes * 8) / 1e6) / seconds, 2);
    return { down: mbit(adapter.bytesIn - before.bytesIn), up: mbit(adapter.bytesOut - before.bytesOut) };
  }
}
