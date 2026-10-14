import {
  LIMITS,
  PROTOCOL_VERSION,
  type ErrorCode,
  type EventName,
  type Events,
  type TavoraGame,
  type TavoraTheme,
  type TavoraViewport,
} from "@tavora/sdk/protocol";
import { StorageError, type ModuleStore } from "./storage";

/** The parts of Electron's MessagePortMain the bridge uses. */
export interface BridgePort {
  on(event: "message", listener: (event: { data: unknown; ports: { close(): void }[] }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

/**
 * Everything a module may learn about itself. Built by the host from the
 * view that owns the port, never from anything the module sends.
 */
export interface BridgeContext {
  moduleId: string;
  game: TavoraGame;
  store: ModuleStore;
  getViewport(): TavoraViewport;
  getTheme(): TavoraTheme;
}

export const MAX_IN_FLIGHT = 64;

class BridgeError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (context: BridgeContext, params: unknown) => Promise<unknown> | unknown;

function keyParam(params: unknown): string {
  if (typeof params !== "object" || params === null || typeof (params as { key?: unknown }).key !== "string") {
    throw new BridgeError("INVALID_PARAMS", "params.key must be a string");
  }
  return (params as { key: string }).key;
}

function noParams(params: unknown): void {
  if (params !== undefined) throw new BridgeError("INVALID_PARAMS", "this method takes no params");
}

const handlers = new Map<string, Handler>([
  ["game.getCurrent", (context, params) => (noParams(params), { ...context.game })],
  ["storage.get", (context, params) => context.store.get(keyParam(params))],
  [
    "storage.set",
    async (context, params) => {
      const key = keyParam(params);
      if (!("value" in (params as object))) throw new BridgeError("INVALID_PARAMS", "params.value is required");
      await context.store.set(key, (params as { value: unknown }).value);
      return null;
    },
  ],
  [
    "storage.delete",
    async (context, params) => {
      await context.store.delete(keyParam(params));
      return null;
    },
  ],
  ["workspace.getViewport", (context, params) => (noParams(params), context.getViewport())],
  ["ui.getTheme", (context, params) => (noParams(params), context.getTheme())],
]);

/** Serves one module instance over one port. */
export class BridgeSession {
  private inFlight = 0;
  private closed = false;

  constructor(
    private readonly port: BridgePort,
    private readonly context: BridgeContext,
    private readonly onClosed: () => void = () => {},
  ) {
    port.on("message", (event) => {
      // Modules have no reason to hand ports to the host; drop them.
      for (const extra of event.ports) extra.close();
      void this.handle(event.data);
    });
    port.on("close", () => this.markClosed());
    port.start();
  }

  emit<E extends EventName>(event: E, data: Events[E]): void {
    if (!this.closed) this.port.postMessage({ v: PROTOCOL_VERSION, event, data });
  }

  close(): void {
    if (this.closed) return;
    this.port.close();
    this.markClosed();
  }

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClosed();
  }

  private async handle(raw: unknown): Promise<void> {
    if (typeof raw !== "object" || raw === null) return;
    const id = (raw as { id?: unknown }).id;
    // Without a usable id there is nobody to answer.
    if (!Number.isSafeInteger(id) || (id as number) < 1) return;
    const requestId = id as number;

    if (this.inFlight >= MAX_IN_FLIGHT) {
      return this.fail(requestId, "BAD_REQUEST", "too many concurrent requests");
    }
    this.inFlight++;
    try {
      let size: number;
      try {
        size = JSON.stringify(raw)?.length ?? 0;
      } catch {
        throw new BridgeError("BAD_REQUEST", "message must be plain JSON data");
      }
      if (size > LIMITS.maxMessageBytes) throw new BridgeError("BAD_REQUEST", "message is too large");

      const { v, method, params } = raw as { v?: unknown; method?: unknown; params?: unknown };
      if (v !== PROTOCOL_VERSION) throw new BridgeError("BAD_REQUEST", `unsupported protocol version ${String(v)}`);
      const handler = typeof method === "string" ? handlers.get(method) : undefined;
      if (!handler) throw new BridgeError("UNKNOWN_METHOD", `unknown method ${String(method)}`);

      const result = await handler(this.context, params);
      if (!this.closed) this.port.postMessage({ v: PROTOCOL_VERSION, id: requestId, ok: true, result });
    } catch (error) {
      if (error instanceof BridgeError || error instanceof StorageError) {
        this.fail(requestId, error.code, error.message);
      } else {
        console.error(`[tavora] bridge error in ${this.context.moduleId}`, error);
        this.fail(requestId, "INTERNAL", "internal error");
      }
    } finally {
      this.inFlight--;
    }
  }

  private fail(id: number, code: ErrorCode, message: string): void {
    if (!this.closed) this.port.postMessage({ v: PROTOCOL_VERSION, id, ok: false, error: { code, message } });
  }
}
