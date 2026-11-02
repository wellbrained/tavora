// The one dialog slot (`dialog` in host.ts) is also filled by things the host asks on its own: a module wants a link
// opened, a game started, a module asks for a connector. Those arrive at any moment, so one must never take the slot
// from a dialog the user is working in. They go through this queue: a request shows at once when the slot is free,
// and otherwise waits until the dialog in it closes.
//
// Urgency (`rank`, higher is more urgent), decided in host.ts:
//   consent for a connector a module asks for (4) > open in a new panel? (3) > where to open a link (2) > switch to the game (1).
// A request more urgent than the dialog shown replaces it only when that dialog is a request of this queue too (a plain
// choice that holds nothing the user typed); the replaced one is put back in the queue and comes back afterwards.
// Every other dialog, one the user opened or one with input in it (a prompt being typed, a consent, a form), is
// never replaced, however urgent the request: it waits.

export interface DialogSlot<R> {
  get(): R | null;
  set(request: R | null): void;
}

export interface DialogQueue<R extends { kind: string }> {
  /** Shows the request now (slot free, or a less urgent request of this queue in it), else keeps it for later. A request of a kind already waiting, or shown, replaces it. */
  request(request: R): void;
  /** Drops the waiting requests that match, for a question that ended (answered elsewhere, its game closed). Not the one shown. */
  cancel(match: (request: R) => boolean): void;
  /** The slot is free: shows the most urgent request that waits, the oldest first among equals. */
  next(): void;
  /** What waits, in the order it will show. */
  waiting(): readonly R[];
}

/** `rank` gives a request its urgency, and undefined for a dialog that is not a request of this queue. */
export function createDialogQueue<R extends { kind: string }>(slot: DialogSlot<R>, rank: (request: R) => number | undefined): DialogQueue<R> {
  let waiting: R[] = [];

  const urgency = (request: R): number => rank(request) ?? Number.POSITIVE_INFINITY;
  // A stable sort: among equals the one that came first stays first.
  const order = () => (waiting = waiting.map((request, index) => ({ request, index })).sort((a, b) => urgency(b.request) - urgency(a.request) || a.index - b.index).map((item) => item.request));
  const keep = (request: R) => {
    waiting = waiting.filter((other) => other.kind !== request.kind);
    waiting.push(request);
    order();
  };

  return {
    request(request) {
      const open = slot.get();
      if (!open) return slot.set(request);
      const openRank = rank(open);
      if (openRank !== undefined && open.kind === request.kind) return slot.set(request);
      if (openRank !== undefined && urgency(request) > openRank) {
        keep(open);
        return slot.set(request);
      }
      keep(request);
    },
    cancel(match) {
      waiting = waiting.filter((request) => !match(request));
    },
    next() {
      if (slot.get()) return;
      const first = waiting.shift();
      if (first) slot.set(first);
    },
    waiting: () => waiting,
  };
}
