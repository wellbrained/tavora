// The ports Tavora listens on right now on this PC (stream overlays, page imports, Discord sign-in, the dev server).
// network.fetch refuses them for a module's `localhost:<port>` grant, so a module never reaches Tavora itself.
const ports = new Map<number, number>();

/** Notes a port Tavora listens on; call releaseOwnPort with the same port when it stops. */
export function holdOwnPort(port: number): void {
  ports.set(port, (ports.get(port) ?? 0) + 1);
}

export function releaseOwnPort(port: number): void {
  const count = ports.get(port) ?? 0;
  if (count <= 1) ports.delete(port);
  else ports.set(port, count - 1);
}

/** Holds the server's port while it listens. Call it before `listen`. */
export function trackOwnServer(server: { on(event: "listening" | "close", fn: () => void): unknown; address(): unknown }): void {
  let held: number | null = null;
  server.on("listening", () => {
    const address = server.address();
    if (address && typeof address === "object" && "port" in address && typeof address.port === "number") {
      held = address.port;
      holdOwnPort(held);
    }
  });
  server.on("close", () => {
    if (held !== null) releaseOwnPort(held);
    held = null;
  });
}

/** Whether Tavora listens on this port now. */
export function isOwnPort(port: number): boolean {
  return ports.has(port);
}
