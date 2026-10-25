// What a game overlay's window loads (game-overlay-window.ts): the module's overlay page and the files next to it, and
// the state the module published for it, from `tavora-overlay://overlay/`. It answers the same requests as a Stream
// overlay's link does (overlays.ts), so the page, which uses `watchOverlay` from the SDK, can't tell them apart: the
// state comes as server-sent events from `_state`. Nothing here needs the Stream overlays server, a port or a grant.
import { readFile } from "node:fs/promises";
import { OVERLAY_STATE_PATH, type JsonValue } from "@tavora/sdk/protocol";
import { GAME_OVERLAY_SCHEME, contentTypeFor } from "./assets";
import { OVERLAY_CSP, resolveOverlayFile, type OverlayPage } from "./overlays";

/** The only address the window may load anything from. */
export const GAME_OVERLAY_ORIGIN = `${GAME_OVERLAY_SCHEME}://overlay`;

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

/** What the page may be given, looked up at every request so a module that went away or was replaced stops being served. */
export interface GameOverlaySource {
  /** The module's overlay page now, or null when the module is gone or is another publisher's now. */
  page(): OverlayPage | null;
  /** What the module published for the overlay, null for nothing. */
  state(): JsonValue | null;
  /** Calls `fn` with each new state, or with undefined when the overlay's link goes away. Returns a function that stops it. */
  watch(fn: (state: JsonValue | null | undefined) => void): () => void;
}

const plain = (status: number, text: string) => new Response(text, { status, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });

export async function serveGameOverlay(request: Request, source: GameOverlaySource): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.host !== "overlay") return plain(404, "Not found");
    if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "Method not allowed");
    const page = source.page();
    if (!page) return plain(404, "Not found");
    if (url.pathname === `/${OVERLAY_STATE_PATH}`) return eventStream(request, source);
    const file = await resolveOverlayFile(page, url.pathname);
    if (!file) return plain(404, "Not found");
    const body = await readFile(file);
    return new Response(request.method === "HEAD" ? null : new Uint8Array(body), {
      headers: { ...HEADERS, "Content-Type": contentTypeFor(file), "Content-Security-Policy": OVERLAY_CSP },
    });
  } catch (error) {
    console.error("[tavora] game overlay request failed", error);
    return plain(500, "Something went wrong");
  }
}

function eventStream(request: Request, source: GameOverlaySource): Response {
  const headers = { ...HEADERS, "Content-Type": "text/event-stream; charset=utf-8" };
  if (request.method === "HEAD") return new Response(null, { headers });
  const text = new TextEncoder();
  let stop = () => {};
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const end = () => {
        if (closed) return;
        closed = true;
        stop();
        controller.close();
      };
      const send = (state: JsonValue | null) => {
        if (!closed) controller.enqueue(text.encode(`data: ${JSON.stringify({ state })}\n\n`));
      };
      controller.enqueue(text.encode("retry: 2000\n\n"));
      send(source.state());
      stop = source.watch((next) => (next === undefined ? end() : send(next)));
      request.signal.addEventListener("abort", end, { once: true });
    },
    cancel() {
      closed = true;
      stop();
    },
  });
  return new Response(body, { headers });
}
