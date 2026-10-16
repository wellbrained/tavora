import { LIMITS, PROTOCOL_VERSION } from "@tavora/sdk/protocol";
import { measureWire } from "../shared/wire";

// The bridge between a module page and the main process, run inside the
// module's own renderer. The page never holds the main process's port: it
// holds one end of a channel whose other end is here, and only messages that
// pass the limits below are forwarded. Without this the main process would
// first have to receive (and allocate) whatever a module sends before it could
// refuse it, so a few huge messages could crash the whole app. Here the worst
// a module can do is crash itself. The main process still checks everything
// again (main/bridge.ts).

/** The parts of a MessagePort the relay uses. */
export interface RelayPort {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
  start(): void;
}

/** What may wait for an answer at once, in bytes: two largest messages. */
export const MAX_PENDING_BYTES = 2 * LIMITS.maxMessageBytes;

export function relayBridge(host: RelayPort, page: RelayPort): void {
  /** Requests passed on and not answered yet, with their sizes. */
  const pending = new Map<number, number>();
  let pendingBytes = 0;

  host.addEventListener("message", (event) => {
    const id = (event.data as { id?: unknown } | null)?.id;
    if (typeof id === "number") {
      const size = pending.get(id);
      if (size !== undefined) {
        pending.delete(id);
        pendingBytes -= size;
      }
    }
    page.postMessage(event.data);
  });

  page.addEventListener("message", (event) => {
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    const id = (data as { id?: unknown }).id;
    // Without a usable id there is nobody to answer; the main process drops these too.
    if (!Number.isSafeInteger(id) || (id as number) < 1) return;
    const requestId = id as number;
    const refuse = (code: "BAD_REQUEST" | "INVALID_PARAMS", message: string) =>
      page.postMessage({ v: PROTOCOL_VERSION, id: requestId, ok: false, error: { code, message } });

    const measured = measureWire(data, LIMITS.maxMessageBytes);
    if (!measured.ok) {
      return measured.reason === "too-large" ? refuse("BAD_REQUEST", "message is too large") : refuse("INVALID_PARAMS", "message must be plain JSON data");
    }
    if (pending.has(requestId)) return refuse("BAD_REQUEST", "request id is already in use");
    if (pending.size >= LIMITS.maxInFlight || pendingBytes + measured.bytes > MAX_PENDING_BYTES) {
      return refuse("BAD_REQUEST", "too many concurrent requests");
    }
    pending.set(requestId, measured.bytes);
    pendingBytes += measured.bytes;
    host.postMessage(data);
  });

  host.start();
  page.start();
}
