import { describe, expect, it } from "vitest";
import { createDialogQueue } from "./dialog-queue";

type Request = { kind: "prompt" } | { kind: "grant"; onRequest?: number } | { kind: "link"; url: string } | { kind: "game"; id: string } | { kind: "navigation" };

const RANK = (request: Request): number | undefined => {
  switch (request.kind) {
    case "grant":
      return request.onRequest === undefined ? undefined : 4;
    case "navigation":
      return 3;
    case "link":
      return 2;
    case "game":
      return 1;
    default:
      return undefined;
  }
};

function setup() {
  let open: Request | null = null;
  const queue = createDialogQueue<Request>({ get: () => open, set: (request) => (open = request) }, RANK);
  // What the host does: the slot is freed, then the queue is told.
  const close = () => {
    open = null;
    queue.next();
  };
  return { queue, close, shown: () => open, set: (request: Request | null) => (open = request) };
}

describe("dialog queue", () => {
  it("shows a request at once when no dialog is open", () => {
    const { queue, shown } = setup();
    queue.request({ kind: "link", url: "https://a.test" });
    expect(shown()).toEqual({ kind: "link", url: "https://a.test" });
    expect(queue.waiting()).toEqual([]);
  });

  it("makes a request wait while a dialog the user works in is open, and shows it once that closes", () => {
    const { queue, shown, set, close } = setup();
    set({ kind: "prompt" });
    queue.request({ kind: "link", url: "https://a.test" });
    expect(shown()).toEqual({ kind: "prompt" });
    expect(queue.waiting()).toHaveLength(1);
    close();
    expect(shown()).toEqual({ kind: "link", url: "https://a.test" });
    expect(queue.waiting()).toEqual([]);
  });

  it("never replaces a dialog the user opened, however urgent the request", () => {
    const { queue, shown, set, close } = setup();
    set({ kind: "prompt" });
    queue.request({ kind: "grant", onRequest: 7 });
    expect(shown()).toEqual({ kind: "prompt" });
    // A consent the user opened themselves (no onRequest) is no request of the queue either.
    close();
    expect(shown()).toEqual({ kind: "grant", onRequest: 7 });
    queue.request({ kind: "link", url: "https://a.test" });
    set({ kind: "grant" });
    queue.request({ kind: "grant", onRequest: 8 });
    expect(shown()).toEqual({ kind: "grant" });
  });

  it("shows waiting requests most urgent first, the oldest first among equals", () => {
    const { queue, shown, set, close } = setup();
    set({ kind: "prompt" });
    queue.request({ kind: "game", id: "one" });
    queue.request({ kind: "link", url: "https://a.test" });
    queue.request({ kind: "navigation" });
    queue.request({ kind: "grant", onRequest: 1 });
    expect(queue.waiting().map((request) => request.kind)).toEqual(["grant", "navigation", "link", "game"]);
    const order: string[] = [];
    close();
    order.push(shown()!.kind);
    close();
    order.push(shown()!.kind);
    close();
    order.push(shown()!.kind);
    close();
    order.push(shown()!.kind);
    expect(order).toEqual(["grant", "navigation", "link", "game"]);
    close();
    expect(shown()).toBeNull();
  });

  it("puts a more urgent request over a less urgent one of the queue, which comes back after it", () => {
    const { queue, shown, close } = setup();
    queue.request({ kind: "game", id: "one" });
    queue.request({ kind: "grant", onRequest: 3 });
    expect(shown()).toEqual({ kind: "grant", onRequest: 3 });
    expect(queue.waiting()).toEqual([{ kind: "game", id: "one" }]);
    close();
    expect(shown()).toEqual({ kind: "game", id: "one" });
  });

  it("lets an equal or less urgent request wait behind the one shown", () => {
    const { queue, shown } = setup();
    queue.request({ kind: "link", url: "https://a.test" });
    queue.request({ kind: "game", id: "one" });
    queue.request({ kind: "navigation" });
    expect(shown()).toEqual({ kind: "navigation" });
    queue.request({ kind: "game", id: "two" });
    expect(queue.waiting().map((request) => request.kind)).toEqual(["link", "game"]);
  });

  it("updates the shown request in place when the same kind asks again", () => {
    const { queue, shown } = setup();
    queue.request({ kind: "link", url: "https://a.test" });
    queue.request({ kind: "link", url: "https://b.test" });
    expect(shown()).toEqual({ kind: "link", url: "https://b.test" });
    expect(queue.waiting()).toEqual([]);
  });

  it("keeps one waiting request per kind, the newest", () => {
    const { queue, set } = setup();
    set({ kind: "prompt" });
    queue.request({ kind: "link", url: "https://a.test" });
    queue.request({ kind: "link", url: "https://b.test" });
    expect(queue.waiting()).toEqual([{ kind: "link", url: "https://b.test" }]);
  });

  it("drops a waiting request that ended, and leaves the shown one alone", () => {
    const { queue, shown, set, close } = setup();
    set({ kind: "prompt" });
    queue.request({ kind: "game", id: "one" });
    queue.request({ kind: "link", url: "https://a.test" });
    queue.cancel((request) => request.kind === "game");
    expect(queue.waiting()).toEqual([{ kind: "link", url: "https://a.test" }]);
    close();
    expect(shown()).toEqual({ kind: "link", url: "https://a.test" });
    queue.cancel(() => true);
    expect(shown()).toEqual({ kind: "link", url: "https://a.test" });
  });

  it("does nothing on next() while a dialog is open or nothing waits", () => {
    const { queue, shown, set } = setup();
    queue.next();
    expect(shown()).toBeNull();
    set({ kind: "prompt" });
    queue.request({ kind: "game", id: "one" });
    queue.next();
    expect(shown()).toEqual({ kind: "prompt" });
    expect(queue.waiting()).toHaveLength(1);
  });
});
