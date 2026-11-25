/**
 * Work an answer doesn't wait for (a notice mail sent after the answer went out, accounts.ts sendLater). The clean stop
 * waits for it within its grace time before it closes the stores (server-start.ts shutDownOnSignals), so a deploy right
 * after an email change still sends the old address its warning (review of #976).
 */
export class BackgroundWork {
  private readonly running = new Set<Promise<unknown>>();

  /** Keeps `work` until it settles; its failure is its own to handle (it is never thrown here). */
  add(work: Promise<unknown>): void {
    const kept = work.then(
      () => undefined,
      () => undefined,
    );
    this.running.add(kept);
    void kept.then(() => this.running.delete(kept));
  }

  /** How much is still running. */
  get size(): number {
    return this.running.size;
  }

  /** Settles once everything added so far, and anything added meanwhile, has settled. */
  async settled(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }
}
