import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { encodeFrame, FrameReader, OP } from "./discord-rpc";

// A pretend Discord app for tests: it listens where Discord would, answers
// commands with what the test says, and can send events.

export type Answer = { data: unknown } | { error: { code: number; message: string } };

export interface FakeDiscord {
  path: string;
  /** Every command received, in order. */
  commands: { cmd: string; args: Record<string, unknown>; evt?: string }[];
  /** How to answer a command; unknown commands get an empty object. */
  answers: Map<string, (args: Record<string, unknown>) => Answer>;
  dispatch(evt: string, data: unknown): void;
  /** Ends every connection, as when Discord quits. */
  drop(): void;
  close(): Promise<void>;
  /** The client id the last hello carried. */
  clientId: string | null;
}

export async function fakeDiscord(): Promise<FakeDiscord> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tavora-discord-"));
  const where = process.platform === "win32" ? `\\\\?\\pipe\\tavora-test-${path.basename(dir)}` : path.join(dir, "discord-ipc-0");
  const sockets = new Set<net.Socket>();
  const fake: FakeDiscord = {
    path: where,
    commands: [],
    answers: new Map(),
    clientId: null,
    dispatch(evt, data) {
      for (const socket of sockets) socket.write(encodeFrame(OP.frame, { cmd: "DISPATCH", evt, data, nonce: null }));
    },
    drop() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
    },
    close: () =>
      new Promise((resolve) => {
        fake.drop();
        server.close(() => resolve());
      }),
  };
  const server = net.createServer((socket) => {
    sockets.add(socket);
    const reader = new FrameReader();
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      for (const { op, data } of reader.push(chunk)) {
        const message = data as { cmd: string; args: Record<string, unknown>; evt?: string; nonce: string; client_id?: string };
        if (op === OP.handshake) {
          fake.clientId = message.client_id ?? null;
          socket.write(encodeFrame(OP.frame, { cmd: "DISPATCH", evt: "READY", data: { v: 1 }, nonce: null }));
          continue;
        }
        fake.commands.push({ cmd: message.cmd, args: message.args, ...(message.evt ? { evt: message.evt } : {}) });
        const answer = fake.answers.get(message.cmd)?.(message.args) ?? { data: {} };
        socket.write(
          encodeFrame(
            OP.frame,
            "error" in answer
              ? { cmd: message.cmd, evt: "ERROR", data: answer.error, nonce: message.nonce }
              : { cmd: message.cmd, evt: message.evt ?? null, data: answer.data, nonce: message.nonce },
          ),
        );
      }
    });
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(where, resolve));
  return fake;
}

export const until = async (check: () => boolean, ms = 2000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
