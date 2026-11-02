// The one dialog slot (`dialog` in host.ts) is also filled by things the host asks on its own: a module wants a link
// opened, a game started, a module asks for a connector. Those arrive at any moment, so one must never take the slot
// from a dialog the user is working in, and none may stack on a dialog that has no business under another. They go
// through this queue: a request shows at once when nothing is open, and otherwise waits until it is.
//
// "Open" means the slot, and any other dialog on the page (the slot's `blocked`: Pairing, Hotkey, Publish, the cloud
// copy question, an inbox note, Search ... counted from the page itself, so a new dialog is covered without being listed).
// Settings and the profile are the exception: a request may stack on top of them, as a confirmation does.
//
// Urgency (`rank`, higher is more urgent), decided in host.ts:
//   consent for a connector a module asks for (4) > open in a new panel (3) > where to open a link (2) > switch to the game (1).
// A request more urgent than the dialog shown replaces it only when that dialog is a request of this queue too (a plain
// choice that holds nothing the user typed) and no other dialog is open; the replaced one is put back in the queue and
// comes back afterwards. With another dialog open the request waits, and is shown when that closes.
// Every other dialog, one the user opened or one with input in it (a prompt being typed, a consent, a form), is
// never replaced, however urgent the request: it waits.
//
// And the other way round: a dialog the user opens (`open`) replaces a request that is shown, but the request is not lost:
// it goes back in the queue and shows again once the slot is free, unless its question ended meanwhile (`cancel`).

export interface DialogSlot<R> {
  get(): R | null;
  set(request: R | null): void;
  /** Another dialog is open that a request must not stack on (not the slot's own dialog, not Settings or the profile). */
  blocked(): boolean;
}

export interface DialogQueue<R extends { kind: string }> {
  /** Shows the request now (nothing open, or a less urgent request of this queue in the slot and no other dialog), else keeps it for later. A request of a kind already shown or waiting replaces it. */
  request(request: R): void;
  /** Opens a dialog the user asked for, now. A request that was shown goes back in the queue instead of being lost. */
  open(request: R): void;
  /** Drops the requests that match, for a question that ended (answered elsewhere, its game closed): waiting ones, and the one shown. */
  cancel(match: (request: R) => boolean): void;
  /** Something closed: shows the most urgent request that waits, the oldest first among equals, if nothing is open. */
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
  // Shows the most urgent request that waits: in a free slot, or in place of a less urgent request of the queue. Neither
  // while another dialog is open: a request must not stack on it, and putting one under it would hide it there.
  const show = () => {
    const first = waiting[0];
    if (!first || slot.blocked()) return;
    const open = slot.get();
    if (open === null) {
      waiting.shift();
      return slot.set(first);
    }
    const openRank = rank(open);
    if (openRank === undefined || urgency(first) <= openRank) return;
    waiting.shift();
    keep(open);
    slot.set(first);
  };

  return {
    request(request) {
      const open = slot.get();
      // The same question again, with new details: the one shown is updated in place.
      if (open && rank(open) !== undefined && open.kind === request.kind) return slot.set(request);
      // Through the waiting line, so a more urgent request that waits is not passed by a newer one.
      keep(request);
      show();
    },
    open(request) {
      const open = slot.get();
      if (open && rank(open) !== undefined) keep(open);
      slot.set(request);
    },
    cancel(match) {
      waiting = waiting.filter((request) => !match(request));
      const open = slot.get();
      if (open && rank(open) !== undefined && match(open)) slot.set(null);
    },
    next: show,
    waiting: () => waiting,
  };
}
