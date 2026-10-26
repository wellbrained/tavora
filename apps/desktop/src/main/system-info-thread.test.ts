import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemConnection, SystemInfo, SystemSnapshot } from "@tavora/sdk/protocol";
import { parseWatch } from "./system-info-parse";
import { IDLE_MS, RESTART_MS, SystemMonitorThread, type FromWorker, type ToWorker, type WorkerLike } from "./system-info-thread";

const INFO: SystemInfo = { cpu: { model: "Test CPU", threads: 4 }, ramBytes: 16e9, gpus: [], drives: [] };

/** A worker that only records what it is told; the test answers for it. */
class FakeWorker implements WorkerLike {
  received: ToWorker[] = [];
  terminated = false;
  private readonly listeners = { message: [] as ((message: FromWorker) => void)[], error: [] as ((error: Error) => void)[], exit: [] as ((code: number) => void)[] };
  postMessage(message: ToWorker): void {
    this.received.push(structuredClone(message));
  }
  on(event: "message" | "error" | "exit", listener: (value: never) => void): this {
    (this.listeners[event] as unknown[]).push(listener);
    return this;
  }
  terminate(): void {
    this.terminated = true;
  }
  send(message: FromWorker): void {
    for (const listener of this.listeners.message) listener(structuredClone(message));
  }
  crash(): void {
    for (const listener of this.listeners.exit) listener(1);
  }
}

let workers: FakeWorker[];
let thread: SystemMonitorThread;
const logged: string[] = [];
const latest = () => workers[workers.length - 1]!;
const cpu = (intervalMs: 1000 | 5000 = 1000) => parseWatch({ blocks: { cpu: true }, intervalMs });

const ONLINE: SystemConnection = { state: "online", routerMs: 2, internetMs: 14, routerFound: true, lossPercent: 0, downMbit: 1.5, upMbit: 0.2, target: "1.1.1.1", since: null };
/** The connection watcher's listeners, as the test's stand-in for it collected them. */
let connectionListeners: ((connection: SystemConnection) => void)[];

function listener() {
  const snapshots: SystemSnapshot[] = [];
  const changes: SystemConnection[] = [];
  let drives = 0;
  return {
    snapshots,
    changes,
    get drives() { return drives; },
    target: { snapshot: (s: SystemSnapshot) => void snapshots.push(s), drivesChanged: () => void drives++, connectionChanged: (c: SystemConnection) => void changes.push(c) },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  workers = [];
  logged.length = 0;
  connectionListeners = [];
  thread = new SystemMonitorThread({
    connection: {
      read: () => ONLINE,
      onChange: (tell) => {
        connectionListeners.push(tell);
        return () => undefined;
      },
    },
    start: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    tavora: () => ({ cpu: 1.26, memoryBytes: 300e6 }),
    log: (message) => void logged.push(message),
  });
});

afterEach(() => {
  thread.dispose();
  vi.useRealTimers();
});

describe("the worker", () => {
  it("starts only when a panel asks", () => {
    const subscription = thread.subscribe(listener().target);
    expect(workers).toHaveLength(0);
    subscription.watch(cpu());
    expect(workers).toHaveLength(1);
    expect(latest().received).toEqual([{ type: "subscribe", sub: expect.any(Number) }, { type: "watch", sub: expect.any(Number), request: cpu() }]);
  });

  it("answers info from the worker", async () => {
    const asked = thread.info();
    const message = latest().received[0]!;
    expect(message.type).toBe("info");
    latest().send({ type: "info", id: (message as { id: number }).id, info: INFO });
    await expect(asked).resolves.toEqual(INFO);
  });

  it("answers the apps from the worker, and passes on a failure", async () => {
    const apps = { apps: [{ name: "Firefox", memoryBytes: 6.8e9, cpu: 1.2, windows: false }], usedBytes: 20e9 };
    const asked = thread.apps();
    const message = latest().received[0] as { type: string; id: number };
    expect(message.type).toBe("apps");
    latest().send({ type: "apps", id: message.id, apps });
    await expect(asked).resolves.toEqual(apps);
    const failing = thread.apps();
    latest().send({ type: "apps", id: (latest().received[1] as { id: number }).id, error: "no ntdll" });
    await expect(failing).rejects.toThrow("no ntdll");
  });

  it("passes on a failed info", async () => {
    const asked = thread.info();
    latest().send({ type: "info", id: (latest().received[0] as { id: number }).id, error: "no PDH" });
    await expect(asked).rejects.toThrow("no PDH");
  });

  it("ends a minute after the last panel stopped watching, and starts again when asked", () => {
    const subscription = thread.subscribe(listener().target);
    subscription.watch(cpu());
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(latest().terminated).toBe(false);
    subscription.close();
    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(latest().terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(latest().terminated).toBe(true);
    thread.subscribe(listener().target).watch(cpu());
    expect(workers).toHaveLength(2);
  });

  it("keeps running while a hidden panel still watches", () => {
    const subscription = thread.subscribe(listener().target);
    subscription.watch(cpu());
    subscription.setSuspended(true);
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(latest().terminated).toBe(false);
    expect(latest().received.at(-1)).toMatchObject({ type: "suspend", suspended: true });
  });

  it("tells a new worker every panel still there after one crashed", async () => {
    const a = thread.subscribe(listener().target);
    a.watch(cpu());
    const b = thread.subscribe(listener().target);
    b.watch(cpu(5000));
    b.setSuspended(true);
    const asked = thread.info();
    latest().crash();
    await expect(asked).rejects.toThrow("stopped");
    expect(logged).toContain("system-info: the worker stopped");
    vi.advanceTimersByTime(RESTART_MS);
    expect(workers).toHaveLength(2);
    const types = latest().received.map((message) => message.type);
    expect(types).toEqual(["subscribe", "watch", "subscribe", "suspend", "watch"]);
  });

  it("does not start again after a crash when nothing watches", () => {
    thread.info().catch(() => undefined);
    latest().crash();
    vi.advanceTimersByTime(RESTART_MS * 2);
    expect(workers).toHaveLength(1);
  });
});

describe("snapshots", () => {
  it("reach only their own panel", () => {
    const a = listener();
    const b = listener();
    const subA = thread.subscribe(a.target);
    subA.watch(cpu());
    thread.subscribe(b.target).watch(cpu());
    const [first] = latest().received as { sub: number }[];
    latest().send({ type: "snapshot", sub: first!.sub, snapshot: { at: 1, intervalMs: 1000 } });
    latest().send({ type: "drivesChanged", sub: first!.sub });
    expect(a.snapshots).toHaveLength(1);
    expect(a.drives).toBe(1);
    expect(b.snapshots).toHaveLength(0);
  });

  it("get Tavora's own use filled in here, only when watched", () => {
    const a = listener();
    const subscription = thread.subscribe(a.target);
    subscription.watch(parseWatch({ blocks: { tavora: true }, intervalMs: 1000 }));
    const sub = (latest().received[0] as { sub: number }).sub;
    latest().send({ type: "snapshot", sub, snapshot: { at: 1, intervalMs: 1000, tavora: { cpu: 0, memoryBytes: 0 } } });
    expect(a.snapshots[0]!.tavora).toEqual({ cpu: 1.3, memoryBytes: 300e6 });
    subscription.watch(cpu());
    latest().send({ type: "snapshot", sub, snapshot: { at: 2, intervalMs: 1000 } });
    expect(a.snapshots[1]!.tavora).toBeUndefined();
  });

  it("get the connection filled in here, only when watched", () => {
    const a = listener();
    const subscription = thread.subscribe(a.target);
    subscription.watch(parseWatch({ blocks: { connection: true }, intervalMs: 1000 }));
    const sub = (latest().received[0] as { sub: number }).sub;
    latest().send({ type: "snapshot", sub, snapshot: { at: 1, intervalMs: 1000 } });
    expect(a.snapshots[0]!.connection).toEqual(ONLINE);
    subscription.watch(cpu());
    latest().send({ type: "snapshot", sub, snapshot: { at: 2, intervalMs: 1000 } });
    expect(a.snapshots[1]!.connection).toBeUndefined();
  });

  it("pass a change of the connection to shown panels that watch it", () => {
    const watching = listener();
    const hidden = listener();
    const other = listener();
    thread.subscribe(watching.target).watch(parseWatch({ blocks: { connection: true }, intervalMs: 1000 }));
    const away = thread.subscribe(hidden.target);
    away.watch(parseWatch({ blocks: { connection: true }, intervalMs: 1000 }));
    away.setSuspended(true);
    thread.subscribe(other.target).watch(cpu());
    const down = { ...ONLINE, state: "no-internet" as const, internetMs: null, since: 5 };
    for (const tell of connectionListeners) tell(down);
    expect(watching.changes).toEqual([down]);
    expect(hidden.changes).toEqual([]);
    expect(other.changes).toEqual([]);
  });

  it("stop after the panel closed", () => {
    const a = listener();
    const subscription = thread.subscribe(a.target);
    subscription.watch(cpu());
    const sub = (latest().received[0] as { sub: number }).sub;
    subscription.close();
    expect(latest().received.at(-1)).toEqual({ type: "close", sub });
    latest().send({ type: "snapshot", sub, snapshot: { at: 1, intervalMs: 1000 } });
    expect(a.snapshots).toHaveLength(0);
  });

  it("a panel that throws doesn't stop the others", () => {
    const b = listener();
    thread.subscribe({ snapshot: () => { throw new Error("boom"); }, drivesChanged: () => undefined }).watch(cpu());
    thread.subscribe(b.target).watch(cpu());
    const subs = (latest().received.filter((message) => message.type === "subscribe") as { sub: number }[]).map((message) => message.sub);
    for (const sub of subs) latest().send({ type: "snapshot", sub, snapshot: { at: 1, intervalMs: 1000 } });
    expect(b.snapshots).toHaveLength(1);
    expect(logged).toContain("system-info: a panel could not be told");
  });
});
