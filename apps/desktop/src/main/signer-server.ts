import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import path from "node:path";
import { MAX_SIGNER_MESSAGE, signerAddress, type SignerAnswer, type SignerRequest } from "@tavora/pack";

// Where the pack command asks Tavora to sign (@tavora/pack's signer.ts): a named pipe on Windows, which
// only the Windows user who made it may write to, and elsewhere a socket in ~/.tavora that only its owner
// may open. Nothing on the network or in a web page can reach either. One request per connection, as one
// JSON line; the answer is one JSON object, then the connection closes. Each signature still waits for the
// developer's click (developer-keys.ts).

export interface SignerServer {
  close(): Promise<void>;
}

/** How long the pack command may take to send its request. */
const READ_MS = 30_000;

export async function startSignerServer(options: { handle: (request: SignerRequest) => Promise<SignerAnswer>; address?: string; log?: (line: string) => void }): Promise<SignerServer | null> {
  const address = options.address ?? signerAddress();
  const pipe = address.startsWith("\\\\.\\pipe\\");
  if (!pipe) {
    await mkdir(path.dirname(address), { recursive: true, mode: 0o700 });
    // The folder may be older (the pack command made it); nobody else needs to look into it.
    await chmod(path.dirname(address), 0o700).catch(() => undefined);
    // Left over from a Tavora that didn't close: only one Tavora runs at a time.
    await rm(address, { force: true });
  }
  const server: Server = createServer((socket) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let read = false;
    socket.setTimeout(READ_MS, () => !read && socket.destroy());
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      if (read) return;
      size += chunk.length;
      if (size > MAX_SIGNER_MESSAGE) return void socket.destroy();
      chunks.push(chunk);
      const all = Buffer.concat(chunks);
      const end = all.indexOf(0x0a);
      if (end < 0) return;
      read = true;
      socket.setTimeout(0);
      let request: SignerRequest | null = null;
      try {
        const parsed = JSON.parse(all.subarray(0, end).toString("utf8")) as SignerRequest;
        if (parsed && typeof parsed === "object" && parsed.v === 1) request = parsed;
      } catch {
        request = null;
      }
      const answer: Promise<SignerAnswer> = request
        ? options.handle(request).catch((error: unknown) => {
            options.log?.(`signer: ${(error as Error).message}`);
            return { ok: false, reason: "failed" } as const;
          })
        : Promise.resolve({ ok: false, reason: "bad-request" } as const);
      void answer.then((reply) => {
        if (!socket.destroyed) socket.end(JSON.stringify(reply));
      });
    });
  });
  const listening = await new Promise<boolean>((resolve) => {
    server.once("error", (error) => {
      options.log?.(`signer: not listening (${error.message})`);
      resolve(false);
    });
    server.listen(address, () => resolve(true));
  });
  if (!listening) return null;
  if (!pipe) await chmod(address, 0o600).catch(() => undefined);
  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        if (!pipe) void rm(address, { force: true });
      }),
  };
}
