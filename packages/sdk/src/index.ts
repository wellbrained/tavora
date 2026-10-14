// @tavora/sdk: thin typed client for modules running inside Tavora Desktop.
// Draft contract from the project kit (docs/15). Not a stable API.
// The host enforces every check; this package only marshals typed calls.

import {
  HELLO_MESSAGE,
  PORT_MESSAGE,
  PROTOCOL_VERSION,
  type ErrorCode,
  type EventName,
  type Events,
  type HostMessage,
  type JsonValue,
  type MethodName,
  type Methods,
  type TavoraGame,
  type TavoraTheme,
  type TavoraViewport,
} from "./protocol";

export type { ErrorCode, JsonValue, TavoraGame, TavoraTheme, TavoraViewport } from "./protocol";

export class TavoraError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TavoraError";
  }
}

type Unsubscribe = () => void;

export interface TavoraSDK {
  game: {
    getCurrent(): Promise<TavoraGame>;
  };
  storage: {
    get<T extends JsonValue = JsonValue>(key: string): Promise<T | null>;
    set(key: string, value: JsonValue): Promise<void>;
    delete(key: string): Promise<void>;
  };
  workspace: {
    getViewport(): Promise<TavoraViewport>;
    onResize(fn: (viewport: TavoraViewport) => void): Unsubscribe;
  };
  ui: {
    getTheme(): Promise<TavoraTheme>;
    onThemeChange(fn: (theme: TavoraTheme) => void): Unsubscribe;
  };
  lifecycle: {
    onSuspend(fn: () => void): Unsubscribe;
    onResume(fn: () => void): Unsubscribe;
    /** Best effort only: autosave must not depend on this firing. */
    onDispose(fn: () => void): Unsubscribe;
  };
}

export interface ConnectOptions {
  /** How long to wait for the host to hand over a port. Default 5000 ms. */
  connectTimeoutMs?: number;
  /** How long to wait for each request. Default 10000 ms. */
  requestTimeoutMs?: number;
}

let connection: Promise<TavoraSDK> | undefined;

/**
 * Connects to the Tavora host. Safe to call more than once: every call
 * returns the same connection for this window.
 */
export function connect(options: ConnectOptions = {}): Promise<TavoraSDK> {
  connection ??= openPort(options.connectTimeoutMs ?? 5000).then(
    (port) => createClient(port, options.requestTimeoutMs ?? 10_000),
    (error: unknown) => {
      connection = undefined;
      throw error;
    },
  );
  return connection;
}

function openPort(timeoutMs: number): Promise<MessagePort> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new TavoraError("HOST_UNAVAILABLE", "Tavora host did not respond. Is this module running inside Tavora?"));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.type !== PORT_MESSAGE || !event.ports[0]) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event.ports[0]);
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ type: HELLO_MESSAGE, v: PROTOCOL_VERSION }, window.location.origin);
  });
}

function createClient(port: MessagePort, requestTimeoutMs: number): TavoraSDK {
  let nextId = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: TavoraError): void; timer: ReturnType<typeof setTimeout> }>();
  const listeners = new Map<EventName, Set<(data: unknown) => void>>();

  port.onmessage = (event: MessageEvent<HostMessage>) => {
    const message = event.data;
    if (typeof message !== "object" || message === null || message.v !== PROTOCOL_VERSION) return;

    if ("event" in message) {
      for (const fn of listeners.get(message.event) ?? []) {
        try {
          fn(message.data);
        } catch (error) {
          console.error(`[tavora] ${message.event} listener failed`, error);
        }
      }
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new TavoraError(message.error.code, message.error.message));
  };
  port.start();

  function call<M extends MethodName>(method: M, params?: Methods[M]["params"]): Promise<Methods[M]["result"]> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new TavoraError("TIMEOUT", `${method} timed out`));
      }, requestTimeoutMs);
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      port.postMessage({ v: PROTOCOL_VERSION, id, method, params });
    });
  }

  function on<E extends EventName>(event: E, fn: (data: Events[E]) => void): Unsubscribe {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    const listener = fn as (data: unknown) => void;
    set.add(listener);
    return () => set.delete(listener);
  }

  return {
    game: {
      getCurrent: () => call("game.getCurrent"),
    },
    storage: {
      get: <T extends JsonValue = JsonValue>(key: string) => call("storage.get", { key }) as Promise<T | null>,
      set: async (key, value) => {
        await call("storage.set", { key, value });
      },
      delete: async (key) => {
        await call("storage.delete", { key });
      },
    },
    workspace: {
      getViewport: () => call("workspace.getViewport"),
      onResize: (fn) => on("workspace.resize", fn),
    },
    ui: {
      getTheme: () => call("ui.getTheme"),
      onThemeChange: (fn) => on("ui.theme", fn),
    },
    lifecycle: {
      onSuspend: (fn) => on("lifecycle.suspend", fn),
      onResume: (fn) => on("lifecycle.resume", fn),
      onDispose: (fn) => on("lifecycle.dispose", fn),
    },
  };
}
