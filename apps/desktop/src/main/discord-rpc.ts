import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";

// The local connection to the Discord desktop app (Discord's "RPC"): a named
// pipe on Windows, a Unix socket elsewhere. Frames are an opcode and a length,
// both 32-bit little-endian, followed by that many bytes of JSON.

export const OP = { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 } as const;

/** Largest frame Tavora accepts from Discord; a voice channel's state is a few kilobytes. */
export const MAX_FRAME = 1024 * 1024;
/** How long a command may take before it fails. Approving in Discord's pop-up can take a while. */
export const COMMAND_TIMEOUT_MS = 15_000;
export const AUTHORIZE_TIMEOUT_MS = 120_000;

export function encodeFrame(op: number, payload: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(payload));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

/** Splits a byte stream into frames. Throws on a frame that is too large or not JSON. */
export class FrameReader {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): { op: number; data: unknown }[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: { op: number; data: unknown }[] = [];
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const length = this.buffer.readInt32LE(4);
      if (length < 0 || length > MAX_FRAME) throw new Error("Discord sent a frame Tavora does not accept.");
      if (this.buffer.length < 8 + length) break;
      const body = this.buffer.subarray(8, 8 + length).toString("utf8");
      this.buffer = this.buffer.subarray(8 + length);
      frames.push({ op, data: JSON.parse(body) as unknown });
    }
    return frames;
  }
}

/**
 * Where the Discord app listens, in the order Discord itself tries them
 * (discord-ipc-0 to 9). On Linux, Flatpak and Snap installs keep the socket
 * in a folder of their own.
 */
export function ipcPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const numbers = Array.from({ length: 10 }, (_, i) => i);
  if (platform === "win32") return numbers.map((i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const base = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp";
  const folders = [base, path.join(base, "app", "com.discordapp.Discord"), path.join(base, "snap.discord")];
  return folders.flatMap((folder) => numbers.map((i) => path.join(folder, `discord-ipc-${i}`)));
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RpcMessage {
  cmd: string;
  evt: string | null;
  nonce: string | null;
  data: unknown;
}

export interface RpcEvents {
  /** A subscribed event (VOICE_STATE_UPDATE, SPEAKING_START, …). */
  onEvent(evt: string, data: unknown): void;
  /** The connection ended; the client cannot be used again. */
  onClose(reason: string): void;
}

/**
 * One connection to the Discord app. Commands resolve with Discord's answer
 * or reject with an RpcError; nothing here interprets what Discord says.
 */
export class RpcClient {
  private readonly pending = new Map<string, { resolve(data: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly reader = new FrameReader();
  private closed = false;
  /** Discord said READY; only then does closing tell the owner. */
  private ready = false;

  private constructor(
    private readonly socket: net.Socket,
    private readonly events: RpcEvents,
  ) {
    socket.on("data", (chunk: Buffer) => {
      try {
        for (const frame of this.reader.push(chunk)) this.receive(frame.op, frame.data);
      } catch (error) {
        this.close(error instanceof Error ? error.message : "Discord sent something Tavora could not read.");
      }
    });
    socket.on("error", () => this.close("The connection to Discord was lost."));
    socket.on("close", () => this.close("The connection to Discord was lost."));
  }

  /**
   * Connects to the first Discord app that answers and says hello with the
   * application's client id. Resolves once Discord is READY, or null when no
   * Discord app is running.
   */
  static async connect(clientId: string, events: RpcEvents, paths = ipcPaths(process.platform, process.env)): Promise<RpcClient | null> {
    for (const where of paths) {
      const socket = await openSocket(where);
      if (!socket) continue;
      const client = new RpcClient(socket, events);
      const ready = await client.handshake(clientId).then(
        () => true,
        () => false,
      );
      if (ready) return client;
      client.close("Discord did not answer.");
    }
    return null;
  }

  private handshake(clientId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), COMMAND_TIMEOUT_MS);
      this.pending.set("READY", {
        resolve: () => resolve(),
        reject,
        timer,
      });
      this.socket.write(encodeFrame(OP.handshake, { v: 1, client_id: clientId }));
    });
  }

  private receive(op: number, data: unknown): void {
    if (op === OP.ping) {
      this.socket.write(encodeFrame(OP.pong, data));
      return;
    }
    if (op === OP.close) {
      const message = (data as { message?: unknown } | null)?.message;
      this.close(typeof message === "string" ? message.slice(0, 200) : "Discord closed the connection.");
      return;
    }
    if (op !== OP.frame || typeof data !== "object" || data === null) return;
    const message = data as RpcMessage;
    if (message.cmd === "DISPATCH" && message.evt === "READY") {
      this.ready = true;
      this.settle("READY", message);
      return;
    }
    if (typeof message.nonce === "string" && this.pending.has(message.nonce)) {
      this.settle(message.nonce, message);
      return;
    }
    if (message.cmd === "DISPATCH" && typeof message.evt === "string") this.events.onEvent(message.evt, message.data);
  }

  private settle(key: string, message: RpcMessage): void {
    const waiting = this.pending.get(key);
    if (!waiting) return;
    this.pending.delete(key);
    clearTimeout(waiting.timer);
    if (message.evt === "ERROR") {
      const error = (message.data ?? {}) as { code?: unknown; message?: unknown };
      waiting.reject(new RpcError(typeof error.code === "number" ? error.code : 0, typeof error.message === "string" ? error.message.slice(0, 200) : "Discord refused."));
    } else waiting.resolve(message.data);
  }

  command<T = unknown>(cmd: string, args: Record<string, unknown> = {}, evt?: string, timeout = COMMAND_TIMEOUT_MS): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError(0, "Not connected to Discord."));
    const nonce = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new RpcError(0, "Discord did not answer in time."));
      }, timeout);
      this.pending.set(nonce, { resolve: resolve as (data: unknown) => void, reject, timer });
      this.socket.write(encodeFrame(OP.frame, { cmd, args, nonce, ...(evt ? { evt } : {}) }));
    });
  }

  subscribe(evt: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.command("SUBSCRIBE", args, evt);
  }

  unsubscribe(evt: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.command("UNSUBSCRIBE", args, evt);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(reason = "Disconnected from Discord."): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new RpcError(0, reason));
    }
    this.pending.clear();
    this.socket.destroy();
    if (this.ready) this.events.onClose(reason);
  }
}

function openSocket(where: string): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection(where);
    socket.once("connect", () => {
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", () => resolve(null));
  });
}
