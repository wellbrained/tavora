import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import { checkTarget, isPublicAddress, type FetchPolicy } from "./network";
import { trackOwnServer } from "./own-ports";

/** Chromium's DNS is deliberately bypassed: each CONNECT uses a checked, pinned public IP. */
/** How long one address gets to answer before the next is tried: one that drops packets would otherwise hold the page for ~20 s. */
export const CONNECT_TRY_MS = 3000;

export async function createPageProxy(policy: FetchPolicy, signal: AbortSignal, tryMs = CONNECT_TRY_MS): Promise<{ port: number; close(): void }> {
  const sockets = new Set<net.Socket>();
  let connections = 0, transferred = 0;
  const server = http.createServer((_req, res) => { res.writeHead(403).end(); });
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", chunk => {
      transferred += chunk.length;
      if (transferred > 20 * 1024 * 1024) close();
    });
  };
  const close = () => { for (const socket of sockets) socket.destroy(); server.close(); };
  trackOwnServer(server);
  server.on("connection", track);
  server.on("connect", (req, client, head) => {
    void (async () => {
      if (signal.aborted || ++connections > 100) throw Error("Page connection limit");
      if (!/^[a-z0-9.-]+:443$/i.test(req.url ?? "")) throw Error("HTTPS required");
      const url = checkTarget(`https://${req.url}`, policy);
      const addresses = await lookup(url.hostname, { all: true });
      if (!addresses.length || !addresses.every(entry => isPublicAddress(entry.address))) throw Error("Public addresses only");
      // The grant can be revoked while DNS is resolving.
      checkTarget(url.href, policy);
      if (signal.aborted) throw Error("Page closed");
      // Every address was checked above; try them in turn, so one that doesn't answer (an IPv6 one, say) doesn't stop the page.
      let attempt: net.Socket | undefined;
      client.once("close", () => attempt?.destroy());
      let upstream: net.Socket | undefined;
      for (const { address } of addresses) {
        if (signal.aborted || client.destroyed) throw Error("Page closed");
        const socket = attempt = net.connect({ host: address, port: 443 });
        track(socket);
        socket.setTimeout(tryMs, () => socket.destroy());
        const connected = await new Promise<boolean>(resolve => {
          socket.once("connect", () => resolve(true));
          socket.once("close", () => resolve(false));
        });
        if (connected) socket.setTimeout(0);
        if (connected) { upstream = socket; break; }
      }
      if (!upstream) throw Error("No address answered");
      if (signal.aborted || client.destroyed) return upstream.destroy();
      upstream.once("close", () => client.destroy());
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    })().catch(() => client.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as net.AddressInfo).port;
  signal.addEventListener("abort", close, { once: true });
  if (signal.aborted) close();
  return { port, close: () => { signal.removeEventListener("abort", close); close(); } };
}
