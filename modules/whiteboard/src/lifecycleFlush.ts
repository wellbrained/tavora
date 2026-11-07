// Saves what is still waiting when Tavora hides the panel (suspend) or closes it (dispose). The board saver and the
// panel's view both save after a short delay, so a change made just before would otherwise be lost.

import type { TavoraSDK } from "@tavora/sdk";

type Lifecycle = Pick<TavoraSDK["lifecycle"], "onSuspend" | "onDispose">;

/** Runs `flush` on suspend and on dispose; the returned function stops listening. */
export function flushOnLifecycle(lifecycle: Lifecycle, flush: () => void | Promise<void>): () => void {
  const run = () => void Promise.resolve(flush()).catch(() => undefined);
  const stops = [lifecycle.onSuspend(run), lifecycle.onDispose(run)];
  return () => stops.forEach((stop) => stop());
}
