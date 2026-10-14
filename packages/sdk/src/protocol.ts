// Wire protocol v0 between a module and the Tavora host, carried over a
// MessagePort. Draft for Milestone A; it will change before a public release.
//
// Identity (which module, which game) is never part of a message. The host
// binds it to the port when it creates the channel.

export const PROTOCOL_VERSION = 0;

/** Posted by the SDK on its own window to ask the host for a bridge port. */
export const HELLO_MESSAGE = "tavora:hello";
/** Posted by the host preload on the module window, carrying the port. */
export const PORT_MESSAGE = "tavora:port";

export interface TavoraGame {
  id: string;
  displayName: string;
}

export interface TavoraViewport {
  width: number;
  height: number;
}

export interface TavoraTheme {
  mode: "dark" | "light";
  colors: {
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    accent: string;
  };
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Request methods and their params/result types. */
export interface Methods {
  "game.getCurrent": { params: undefined; result: TavoraGame };
  "storage.get": { params: { key: string }; result: JsonValue | null };
  "storage.set": { params: { key: string; value: JsonValue }; result: null };
  "storage.delete": { params: { key: string }; result: null };
  "workspace.getViewport": { params: undefined; result: TavoraViewport };
  "ui.getTheme": { params: undefined; result: TavoraTheme };
}

export type MethodName = keyof Methods;

/** Events the host pushes to the module. */
export interface Events {
  "workspace.resize": TavoraViewport;
  "ui.theme": TavoraTheme;
  "lifecycle.suspend": null;
  "lifecycle.resume": null;
  "lifecycle.dispose": null;
}

export type EventName = keyof Events;

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNKNOWN_METHOD"
  | "INVALID_PARAMS"
  | "QUOTA_EXCEEDED"
  | "PERMISSION_DENIED"
  | "INTERNAL"
  | "TIMEOUT"
  | "DISCONNECTED"
  | "HOST_UNAVAILABLE";

export interface RequestMessage {
  v: typeof PROTOCOL_VERSION;
  id: number;
  method: string;
  params?: unknown;
}

export type ResponseMessage =
  | { v: typeof PROTOCOL_VERSION; id: number; ok: true; result: unknown }
  | { v: typeof PROTOCOL_VERSION; id: number; ok: false; error: { code: ErrorCode; message: string } };

export interface EventMessage {
  v: typeof PROTOCOL_VERSION;
  event: EventName;
  data: unknown;
}

export type HostMessage = ResponseMessage | EventMessage;

export const LIMITS = {
  /** Largest serialized request the host accepts. */
  maxMessageBytes: 1024 * 1024,
  maxKeyLength: 256,
  /** Total serialized size of one module's storage for one game. */
  maxStoreBytes: 5 * 1024 * 1024,
} as const;
