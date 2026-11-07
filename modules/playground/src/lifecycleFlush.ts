// Writes the map and zoom views that are still waiting when Tavora hides the panel (suspend) or closes it (dispose).

import { flushViewMemory } from "@tavora/official-ui";
import type { TavoraSDK } from "@tavora/sdk";

type Lifecycle = Pick<TavoraSDK["lifecycle"], "onSuspend" | "onDispose">;

/** Flushes the remembered views on suspend and on dispose; the returned function stops listening. */
export function flushViewsOnLifecycle(lifecycle: Lifecycle, flush: () => Promise<void> = () => flushViewMemory()): () => void {
  const run = () => void flush().catch(() => undefined);
  const stops = [lifecycle.onSuspend(run), lifecycle.onDispose(run)];
  return () => stops.forEach((stop) => stop());
}
