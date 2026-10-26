/**
 * The system-info connector's SystemMonitor (system-info.ts) runs in a worker thread of its own
 * (system-info-worker.ts), and this is its side in the main process. Every look at the PC is a call into Windows
 * that can wait: a drive that has gone to sleep wakes up first, and Windows' counters take a while the first time.
 * In the worker such a wait holds up only the readings, never Tavora. The worker starts with the first panel that
 * asks and ends a minute after the last one stopped watching, so with no panel it costs nothing. The connection
 * watcher (connection.ts) stays in the main process: its pings already run off the main thread, and it keeps
 * watching while no panel is shown.
 */
import type { SystemApps, SystemInfo, SystemSnapshot } from "@tavora/sdk/protocol";
import type { ConnectionSource } from "./connection";
import type { SystemListener, SystemSubscription, TavoraUsage } from "./system-info";
import { isEmptyWatch, percent, type WatchRequest } from "./system-info-parse";

/** What the main process tells the worker. */
export type ToWorker =
  | { type: "info"; id: number }
  | { type: "apps"; id: number }
  | { type: "subscribe"; sub: number }
  | { type: "watch"; sub: number; request: WatchRequest }
  | { type: "suspend"; sub: number; suspended: boolean }
  | { type: "close"; sub: number };

/** What the worker tells the main process. */
export type FromWorker =
  | { type: "info"; id: number; info: SystemInfo }
  | { type: "info"; id: number; error: string }
  | { type: "apps"; id: number; apps: SystemApps }
  | { type: "apps"; id: number; error: string }
  | { type: "snapshot"; sub: number; snapshot: SystemSnapshot }
  | { type: "drivesChanged"; sub: number }
  | { type: "log"; message: string; error: string };

/** The part of a worker_threads Worker this needs (tests pass a fake one). */
export interface WorkerLike {
  postMessage(message: ToWorker): void;
  on(event: "message", listener: (message: FromWorker) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  terminate(): unknown;
  unref?(): void;
}

export interface SystemMonitorThreadOptions {
  /** Starts the worker. */
  start: () => WorkerLike;
  tavora: () => TavoraUsage;
  /** The connection watcher; panels only read what it found. */
  connection?: ConnectionSource;
  log?: (message: string, error: unknown) => void;
}

/** How long the worker stays after the last panel stopped watching: closing and opening a panel needs no new start. */
export const IDLE_MS = 60_000;
/** How long panels that watch wait for a new worker after one crashed. */
export const RESTART_MS = 5_000;

interface Held {
  listener: SystemListener;
  request: WatchRequest | null;
  suspended: boolean;
}

export class SystemMonitorThread {
  private readonly options: SystemMonitorThreadOptions;
  private worker: WorkerLike | null = null;
  private readonly held = new Map<number, Held>();
  private readonly asked = new Map<number, { resolve: (answer: never) => void; reject: (error: Error) => void }>();
  private nextId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SystemMonitorThreadOptions) {
    this.options = options;
    // Only panels that are shown and watch the connection are told.
    options.connection?.onChange((reading) => {
      for (const held of this.held.values()) {
        if (!held.suspended && held.request?.blocks.connection) this.deliver(() => held.listener.connectionChanged?.(reading));
      }
    });
  }

  /** What this PC is, read in the worker. */
  info(): Promise<SystemInfo> {
    return this.ask("info");
  }

  /** The apps running now, read in the worker (system-apps.ts). Only for Tavora's own System Monitor. */
  apps(): Promise<SystemApps> {
    return this.ask("apps");
  }

  private ask<T>(type: "info" | "apps"): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.asked.set(id, { resolve: resolve as (answer: never) => void, reject });
      this.ensure().postMessage({ type, id });
      this.settle();
    });
  }

  /** A panel's connection, as SystemMonitor.subscribe. */
  subscribe(listener: SystemListener): SystemSubscription {
    const sub = this.nextId++;
    const held: Held = { listener, request: null, suspended: false };
    this.held.set(sub, held);
    let closed = false;
    this.worker?.postMessage({ type: "subscribe", sub });
    return {
      watch: (request) => {
        if (closed) return;
        held.request = request;
        this.tell({ type: "watch", sub, request });
      },
      setSuspended: (suspended) => {
        if (closed || held.suspended === suspended) return;
        held.suspended = suspended;
        this.tell({ type: "suspend", sub, suspended });
      },
      close: () => {
        if (closed) return;
        closed = true;
        this.held.delete(sub);
        this.worker?.postMessage({ type: "close", sub });
        this.settle();
      },
    };
  }

  /** Ends the worker; the monitor stays usable and starts it again when asked. */
  dispose(): void {
    this.held.clear();
    this.stop();
  }

  /** A change to a panel's connection. A worker started now learns it with the rest (ensure). */
  private tell(message: ToWorker): void {
    if (this.worker) this.worker.postMessage(message);
    else this.ensure();
    this.settle();
  }

  /** The worker, started now with every panel that holds a connection. */
  private ensure(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.options.start();
    worker.unref?.();
    worker.on("message", (message) => {
      if (this.worker === worker) this.receive(message);
    });
    worker.on("error", (error) => {
      if (this.worker === worker) this.lost(error);
    });
    worker.on("exit", (code) => {
      if (this.worker === worker) this.lost(new Error(`the system-info worker stopped (${code})`));
    });
    this.worker = worker;
    // A worker that is new, or started again after it stopped, learns every panel that is still there.
    for (const [sub, held] of this.held) {
      worker.postMessage({ type: "subscribe", sub });
      if (held.suspended) worker.postMessage({ type: "suspend", sub, suspended: true });
      if (held.request) worker.postMessage({ type: "watch", sub, request: held.request });
    }
    return worker;
  }

  private receive(message: FromWorker): void {
    switch (message.type) {
      case "info":
      case "apps": {
        const asked = this.asked.get(message.id);
        this.asked.delete(message.id);
        if ("error" in message) asked?.reject(new Error(message.error));
        else asked?.resolve(("info" in message ? message.info : message.apps) as never);
        this.settle();
        return;
      }
      case "snapshot": {
        const held = this.held.get(message.sub);
        if (!held) return;
        this.deliver(() => held.listener.snapshot(this.withMain(held, message.snapshot)));
        return;
      }
      case "drivesChanged": {
        const held = this.held.get(message.sub);
        if (held) this.deliver(() => held.listener.drivesChanged());
        return;
      }
      case "log":
        this.options.log?.(message.message, message.error);
        return;
    }
  }

  /** Tavora's own use (app.getAppMetrics) and the connection are known only here, so they are filled in on the way. */
  private withMain(held: Held, snapshot: SystemSnapshot): SystemSnapshot {
    const connection = this.options.connection;
    if (held.request?.blocks.connection && connection) snapshot = { ...snapshot, connection: connection.read() };
    return this.withTavora(held, snapshot);
  }

  private withTavora(held: Held, snapshot: SystemSnapshot): SystemSnapshot {
    if (!held.request?.blocks.tavora) return snapshot;
    try {
      const usage = this.options.tavora();
      return { ...snapshot, tavora: { cpu: percent(usage.cpu), memoryBytes: Math.max(0, Math.round(usage.memoryBytes)) } };
    } catch (error) {
      this.options.log?.("system-info: could not read Tavora's own use", error);
      const { tavora: _, ...rest } = snapshot;
      return rest;
    }
  }

  private deliver(send: () => void): void {
    try {
      send();
    } catch (error) {
      this.options.log?.("system-info: a panel could not be told", error);
    }
  }

  /** The worker crashed or stopped: answers still due fail, and panels that watch get a new one after a moment. */
  private lost(error: Error): void {
    this.options.log?.("system-info: the worker stopped", error);
    this.worker = null;
    this.failAsked(error);
    this.clearIdle();
    if (!this.busy) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.worker && this.busy) this.ensure();
    }, RESTART_MS);
    this.idleTimer.unref?.();
  }

  private failAsked(error: Error): void {
    for (const asked of this.asked.values()) asked.reject(error);
    this.asked.clear();
  }

  /** Whether some panel watches, or an answer is still due. */
  private get busy(): boolean {
    return this.asked.size > 0 || [...this.held.values()].some((held) => held.request !== null && !isEmptyWatch(held.request.blocks));
  }

  /** Ends the worker a while after nothing needs it. */
  private settle(): void {
    if (!this.worker) return;
    if (this.busy) {
      this.clearIdle();
      return;
    }
    if (this.idleTimer !== null) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.busy) this.stop();
    }, IDLE_MS);
    this.idleTimer.unref?.();
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private stop(): void {
    this.clearIdle();
    const worker = this.worker;
    this.worker = null;
    this.failAsked(new Error("the system-info worker was stopped"));
    if (worker) void worker.terminate();
  }
}
