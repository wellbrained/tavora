/**
 * Runs one file's saves and removals in the order they were asked, each after the one before. A save takes a moment
 * (the system seals it first), so without this a sign-out could delete the file and a save asked before it write it back.
 */
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.tail = settled;
    running.add(settled);
    void settled.then(() => running.delete(settled));
    return result;
  }
}

const running = new Set<Promise<unknown>>();

/** Resolves once every save and removal asked so far is done (quitting waits for it). */
export async function settleSerial(): Promise<void> {
  while (running.size > 0) await Promise.all([...running]);
}
