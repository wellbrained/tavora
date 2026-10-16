import {
  LIMITS,
  PROTOCOL_VERSION,
  RESERVED_METHODS,
  type Capability,
  type DocumentChange,
  type EventName,
  type Events,
  type HandshakeResult,
  type TavoraGame,
  type TavoraTheme,
  type TavoraViewport,
} from "@tavora/sdk/protocol";
import { HostError } from "./errors";
import type { ModuleData, PanelStateStore } from "./storage";

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
  hostVersion: string;
  moduleId: string;
  moduleVersion: string;
  instanceId: string;
  game: TavoraGame;
  data: ModuleData;
  panelState: PanelStateStore;
  capabilities: ReadonlySet<Capability>;
  getViewport(): TavoraViewport;
  getTheme(): TavoraTheme;
  getLanguage(): string;
  /** Whether the panel is hidden right now. */
  isSuspended(): boolean;
  /** Opens a web address in a Browser panel. Throws a HostError when the panel did not just get a click or key press, or the address is not a web address. */
  openLink(url: string): void;
  /**
   * The module started (true) or finished (false) having requests answered; `served` counts the
   * answered ones apart from the handshake. The host uses it to tell when a page has its data.
   */
  onBusy?(busy: boolean, served: number): void;
}

type Handler = (session: BridgeSession, params: unknown) => Promise<unknown> | unknown;

function object(params: unknown): Record<string, unknown> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new HostError("INVALID_PARAMS", "params must be an object");
  }
  return params as Record<string, unknown>;
}

function noParams(params: unknown): void {
  if (params !== undefined) throw new HostError("INVALID_PARAMS", "this method takes no params");
}

function required(params: Record<string, unknown>, name: string): unknown {
  if (!(name in params)) throw new HostError("INVALID_PARAMS", `params.${name} is required`);
  return params[name];
}

/** Longest address links.open accepts. */
const LINK_MAX = 2048;

const handlers = new Map<string, Handler>([
  ["game.getCurrent", (s, params) => (noParams(params), { ...s.context.game })],

  ["storage.get", (s, params) => s.context.data.settings.get(object(params).key)],
  ["storage.keys", (s, params) => (noParams(params), s.context.data.settings.keys())],
  [
    "storage.set",
    async (s, params) => {
      const p = object(params);
      await s.context.data.settings.set(p.key, required(p, "value"));
      return null;
    },
  ],
  [
    "storage.delete",
    async (s, params) => {
      await s.context.data.settings.delete(object(params).key);
      return null;
    },
  ],

  ["documents.list", (s, params) => (noParams(params), s.context.data.documents.list())],
  ["documents.get", (s, params) => s.context.data.documents.get(object(params).id)],
  ["documents.put", (s, params) => s.context.data.documents.put(object(params), s)],
  [
    "documents.delete",
    async (s, params) => {
      const p = object(params);
      await s.context.data.documents.delete(p.id, p.ifRevision, s);
      return null;
    },
  ],

  [
    "links.open",
    (s, params) => {
      const url = required(object(params), "url");
      if (typeof url !== "string" || url.length === 0 || url.length > LINK_MAX) throw new HostError("INVALID_PARAMS", "params.url must be a web address");
      s.context.openLink(url);
      return null;
    },
  ],

  ["panel.getState", (s, params) => (noParams(params), s.context.panelState.get(s.context.instanceId))],
  [
    "panel.setState",
    async (s, params) => {
      await s.context.panelState.set(s.context.instanceId, required(object(params), "value"));
      return null;
    },
  ],

  ["workspace.getViewport", (s, params) => (noParams(params), s.context.getViewport())],
  ["ui.getTheme", (s, params) => (noParams(params), s.context.getTheme())],
  ["ui.getLanguage", (s, params) => (noParams(params), s.context.getLanguage())],
]);

/** Serves one module panel over one port. */
export class BridgeSession {
  private inFlight = 0;
  private served = 0;
  private closed = false;
  private handshakeDone = false;

  constructor(
    private readonly port: BridgePort,
    readonly context: BridgeContext,
    private readonly onClosed: () => void = () => {},
  ) {
    port.on("message", (event) => {
      // Modules have no reason to hand ports to the host; drop them.
      for (const extra of event.ports) extra.close();
      void this.handle(event.data);
    });
    port.on("close", () => this.markClosed());
    context.data.documents.on("change", this.onDocumentChange);
    port.start();
  }

  emit<E extends EventName>(event: E, data: Events[E]): void {
    if (!this.closed && this.handshakeDone) this.port.postMessage({ v: PROTOCOL_VERSION, event, data });
  }

  close(): void {
    if (this.closed) return;
    this.port.close();
    this.markClosed();
  }

  private readonly onDocumentChange = (change: DocumentChange, origin: unknown) => {
    if (origin !== this) this.emit("documents.changed", change);
  };

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.context.data.documents.off("change", this.onDocumentChange);
    this.onClosed();
  }

  private handshake(params: unknown): HandshakeResult {
    const p = object(params);
    if (p.protocol !== PROTOCOL_VERSION) {
      throw new HostError("INCOMPATIBLE", `this host speaks protocol ${PROTOCOL_VERSION}, not ${String(p.protocol)}`, {
        supported: [PROTOCOL_VERSION],
      });
    }
    this.handshakeDone = true;
    return {
      protocol: PROTOCOL_VERSION,
      host: { name: "tavora-desktop", version: this.context.hostVersion },
      module: { id: this.context.moduleId, version: this.context.moduleVersion },
      capabilities: [...this.context.capabilities],
    };
  }

  private async handle(raw: unknown): Promise<void> {
    if (typeof raw !== "object" || raw === null) return;
    const id = (raw as { id?: unknown }).id;
    // Without a usable id there is nobody to answer.
    if (!Number.isSafeInteger(id) || (id as number) < 1) return;
    const requestId = id as number;

    if (this.inFlight >= LIMITS.maxInFlight) {
      return this.fail(requestId, new HostError("BAD_REQUEST", "too many concurrent requests"));
    }
    if (this.inFlight++ === 0) this.context.onBusy?.(true, this.served);
    let handshake = false;
    try {
      let size: number;
      try {
        size = JSON.stringify(raw)?.length ?? 0;
      } catch {
        throw new HostError("BAD_REQUEST", "message must be plain JSON data");
      }
      if (size > LIMITS.maxMessageBytes) throw new HostError("BAD_REQUEST", "message is too large");

      const { v, method, params } = raw as { v?: unknown; method?: unknown; params?: unknown };
      if (v !== PROTOCOL_VERSION) {
        throw new HostError("BAD_REQUEST", `unsupported protocol version ${String(v)}`, { supported: [PROTOCOL_VERSION] });
      }
      if (typeof method !== "string") throw new HostError("UNKNOWN_METHOD", "method must be a string");

      let result: unknown;
      if (method === "bridge.handshake") {
        handshake = true;
        result = this.handshake(params);
      } else if (!this.handshakeDone) {
        throw new HostError("BAD_REQUEST", "call bridge.handshake first");
      } else if (Object.hasOwn(RESERVED_METHODS, method)) {
        const capability = RESERVED_METHODS[method]!;
        // Nothing can grant these yet; the check is here so the error shape
        // stays the same once something can.
        if (!this.context.capabilities.has(capability)) {
          throw new HostError("PERMISSION_DENIED", `${method} needs the "${capability}" permission`, { capability });
        }
        throw new HostError("UNKNOWN_METHOD", `${method} is not available in this host version`);
      } else {
        const handler = handlers.get(method);
        if (!handler) throw new HostError("UNKNOWN_METHOD", `unknown method ${method}`);
        result = await handler(this, params);
      }
      if (!this.closed) this.port.postMessage({ v: PROTOCOL_VERSION, id: requestId, ok: true, result });
      // A panel that connects while hidden learns so right after connecting.
      if (method === "bridge.handshake" && this.context.isSuspended()) this.emit("lifecycle.suspend", null);
    } catch (error) {
      if (error instanceof HostError) {
        this.fail(requestId, error);
      } else {
        console.error(`[tavora] bridge error in ${this.context.moduleId}`, error);
        this.fail(requestId, new HostError("INTERNAL", "internal error"));
      }
    } finally {
      if (!handshake) this.served++;
      if (--this.inFlight === 0) this.context.onBusy?.(false, this.served);
    }
  }

  private fail(id: number, error: HostError): void {
    if (!this.closed) this.port.postMessage({ v: PROTOCOL_VERSION, id, ok: false, error: error.toPayload() });
  }
}
