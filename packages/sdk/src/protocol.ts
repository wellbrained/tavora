// Wire protocol v1 between a module and the Tavora host, carried over a
// MessagePort. Specified in apps/docs/reference/protocol.md.
//
// Identity (which module, which game, which panel) is never part of a
// message. The host binds it to the port when it creates the channel.

/** Major protocol version. Every message carries it as `v`. */
export const PROTOCOL_VERSION = 1;

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
  /** A short summary of the palette, for modules that only need a few colours. */
  colors: {
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    accent: string;
  };
  /**
   * The full semantic palette as CSS colours, named like the CSS variables
   * of shadcn-vue plus Tavora's extras (see THEME_TOKENS). Set each one as
   * `--<name>` to match the host UI.
   */
  tokens: Record<ThemeToken, string>;
  /** Corner radius for buttons, inputs and cards, in CSS pixels. */
  radius: number;
}

/** Names of the semantic colour tokens in TavoraTheme.tokens. */
export const THEME_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-hover",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "rail",
  "success",
  "warning",
  "info",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface HandshakeResult {
  protocol: typeof PROTOCOL_VERSION;
  host: { name: "tavora-desktop"; version: string };
  module: { id: string; version: string };
  /** Capabilities this module has been granted. */
  capabilities: Capability[];
}

export interface DocumentSummary {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  bytes: number;
}

export interface TavoraDocument extends DocumentSummary {
  data: JsonValue;
}

export interface PutDocumentParams {
  /** Omit to create a new document with a host-generated id. */
  id?: string;
  title: string;
  data: JsonValue;
  /** Reject with CONFLICT unless the stored revision still matches. */
  ifRevision?: number;
}

export interface DocumentChange {
  id: string;
  revision: number;
  deleted: boolean;
}

/**
 * Capabilities gate methods beyond the always-available core. None of the
 * gated ones can be granted yet; calling them fails with PERMISSION_DENIED.
 */
export type Capability = "network" | "files" | "clipboard" | "sharedData";

/** Request methods and their params/result types. */
export interface Methods {
  "bridge.handshake": { params: { protocol: number; sdkVersion: string }; result: HandshakeResult };
  "game.getCurrent": { params: undefined; result: TavoraGame };
  "storage.get": { params: { key: string }; result: JsonValue | null };
  "storage.set": { params: { key: string; value: JsonValue }; result: null };
  "storage.delete": { params: { key: string }; result: null };
  "storage.keys": { params: undefined; result: string[] };
  "documents.list": { params: undefined; result: DocumentSummary[] };
  "documents.get": { params: { id: string }; result: TavoraDocument | null };
  "documents.put": { params: PutDocumentParams; result: DocumentSummary };
  "documents.delete": { params: { id: string; ifRevision?: number }; result: null };
  "panel.getState": { params: undefined; result: JsonValue | null };
  "panel.setState": { params: { value: JsonValue | null }; result: null };
  "workspace.getViewport": { params: undefined; result: TavoraViewport };
  "ui.getTheme": { params: undefined; result: TavoraTheme };
  /** The language of Tavora's own texts, as a code such as "en" or "de". */
  "ui.getLanguage": { params: undefined; result: string };
  /** Opens a web address in the game's Browser panel. Only right after a click or key press in the panel; http and https only. */
  "links.open": { params: { url: string }; result: null };
  "blobs.list": { params: undefined; result: BlobInfo[] };
  "blobs.usage": { params: undefined; result: BlobUsage };
  "blobs.delete": { params: { id: string }; result: null };
}

export type MethodName = keyof Methods;

/** Methods reserved for later milestones, and the capability each needs. */
export const RESERVED_METHODS: Readonly<Record<string, Capability>> = {
  "network.fetch": "network",
  "files.open": "files",
  "files.save": "files",
  "clipboard.writeText": "clipboard",
  "clipboard.readText": "clipboard",
  "sharedData.publish": "sharedData",
  "sharedData.read": "sharedData",
  "sharedData.subscribe": "sharedData",
};

/** Events the host pushes to the module. */
export interface Events {
  "workspace.resize": TavoraViewport;
  "ui.theme": TavoraTheme;
  "ui.language": string;
  "documents.changed": DocumentChange;
  "lifecycle.suspend": null;
  "lifecycle.resume": null;
  "lifecycle.dispose": null;
}

export type EventName = keyof Events;

export type ErrorCode =
  /** Malformed message, wrong protocol version or over a limit. */
  | "BAD_REQUEST"
  /** The method is not part of the protocol. */
  | "UNKNOWN_METHOD"
  /** Params are missing or have the wrong shape. */
  | "INVALID_PARAMS"
  /** The method exists but this module has not been granted its capability. */
  | "PERMISSION_DENIED"
  /** A storage, document or panel-state limit would be exceeded. */
  | "QUOTA_EXCEEDED"
  /** `ifRevision` did not match the stored revision. */
  | "CONFLICT"
  /** The SDK and host speak different protocol versions. */
  | "INCOMPATIBLE"
  /** Something failed inside the host. Details are logged there, not sent. */
  | "INTERNAL"
  // Raised by the SDK itself, never sent by the host:
  /** The host did not answer in time. */
  | "TIMEOUT"
  /** connect() found no Tavora host, e.g. the page was opened in a normal browser. */
  | "HOST_UNAVAILABLE";

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  /** Present for PERMISSION_DENIED. */
  capability?: Capability;
  /** Present for CONFLICT. */
  revision?: number;
  /** Present for INCOMPATIBLE and BAD_REQUEST version errors. */
  supported?: number[];
}

export interface RequestMessage {
  v: typeof PROTOCOL_VERSION;
  id: number;
  method: string;
  params?: unknown;
}

export type ResponseMessage =
  | { v: typeof PROTOCOL_VERSION; id: number; ok: true; result: unknown }
  | { v: typeof PROTOCOL_VERSION; id: number; ok: false; error: ErrorPayload };

export interface EventMessage {
  v: typeof PROTOCOL_VERSION;
  event: EventName;
  data: unknown;
}

export type HostMessage = ResponseMessage | EventMessage;

export const LIMITS = {
  /** Largest serialized request the host accepts. */
  maxMessageBytes: 8 * 1024 * 1024,
  /** Requests a module may have waiting at once. */
  maxInFlight: 64,
  maxKeyLength: 256,
  /** Settings storage per module and game. */
  maxStoreBytes: 5 * 1024 * 1024,
  /** One document's data. */
  maxDocumentBytes: 4 * 1024 * 1024,
  /** All documents of one module in one game. */
  maxDocumentsBytes: 50 * 1024 * 1024,
  maxDocuments: 1000,
  maxTitleLength: 200,
  /** UI state for one panel. */
  maxPanelStateBytes: 256 * 1024,
  /** One stored file (see Blobs). */
  maxBlobBytes: 50 * 1024 * 1024,
  /** All stored files of one module in one game. */
  maxBlobsBytes: 500 * 1024 * 1024,
} as const;

/** The kinds of file a module can keep with blobs.put, found by looking at the file itself. */
export const BLOB_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type BlobType = (typeof BLOB_TYPES)[number];

/** A stored file. */
export interface BlobInfo {
  /** 32 lowercase hex characters, chosen by the host. */
  id: string;
  bytes: number;
  type: BlobType;
  createdAt: string;
}

/** How much of the limits a module's files in the current game use. */
export interface BlobUsage {
  bytes: number;
  count: number;
  /** All files together. */
  maxBytes: number;
  /** One file. */
  maxFileBytes: number;
}

/**
 * Files are sent to and shown from the module's own address, not over the
 * bridge: POST /_blobs/ stores the request body and answers with a BlobInfo,
 * GET /_blobs/<id> serves a file. Both only work from the module's own page.
 */
export const BLOB_PATH = "/_blobs/";
export const BLOB_ID = /^[a-f0-9]{32}$/;

/** Document ids: host-generated UUIDs or module-chosen slugs. */
export const DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
