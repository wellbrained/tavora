import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import { checkTarget, isPublicAddress, type FetchPolicy } from "./network";

/** Chromium's DNS is deliberately bypassed: each CONNECT uses a checked, pinned public IP. */
export async function createPageProxy(policy: FetchPolicy, signal: AbortSignal): Promise<{ port: number; close(): void }> {
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
      const upstream = net.connect({ host: addresses[0]!.address, port: 443 });
      track(upstream);
      upstream.once("connect", () => {
        if (signal.aborted) return upstream.destroy();
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream); upstream.pipe(client);
      });
      client.once("close", () => upstream.destroy());
      upstream.once("close", () => client.destroy());
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
