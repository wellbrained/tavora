// How many files one module session (a module in a workspace) writes through its files address at once (audit L8).

/**
 * Uploads one session may write at once; more wait their turn, and past UPLOADS_WAITING waiting the next is refused.
 * Every write holds a move of the pictures folder until it ends, so one module can't keep many open at once. Each store
 * writes one file at a time anyway, so waiting costs a module nothing.
 */
export const UPLOADS_AT_ONCE = 4;
export const UPLOADS_WAITING = 16;

/** Uploads that hold a write slot now (at most UPLOADS_AT_ONCE), and the ones waiting for one, oldest first. */
export interface UploadSlots {
  writing: number;
  readonly queued: (() => void)[];
}

/** A write slot, once one is free (call what it gives to free it); null when too many already wait (refuse the upload). */
export function takeUploadSlot(slots: UploadSlots): Promise<() => void> | null {
  let freed = false;
  const free = () => {
    if (freed) return;
    freed = true;
    // The slot passes straight to the next one waiting, so `writing` stays at the cap while any wait.
    const next = slots.queued.shift();
    if (next) next();
    else slots.writing--;
  };
  if (slots.writing < UPLOADS_AT_ONCE) {
    slots.writing++;
    return Promise.resolve(free);
  }
  if (slots.queued.length >= UPLOADS_WAITING) return null;
  return new Promise((resolve) => slots.queued.push(() => resolve(free)));
}
