/** The pictures (by address) that have loaded in this page before; a picture fades in only the first time. */
const seen = new Set<string>();
/** Enough for every icon and screenshot a session looks at; the oldest are forgotten after that. */
const LIMIT = 300;

/** A short stand-in for a long address (a data address can be megabytes). */
function keyOf(src: string): string {
  return src.length > 512 ? `${src.length}:${src.slice(0, 200)}:${src.slice(-200)}` : src;
}

export function wasSeen(src: string | null | undefined): boolean {
  return !!src && seen.has(keyOf(src));
}

export function markSeen(src: string | null | undefined): void {
  if (!src) return;
  const key = keyOf(src);
  seen.delete(key);
  seen.add(key);
  if (seen.size > LIMIT) seen.delete(seen.values().next().value as string);
}

/** For tests. */
export function forgetSeen(): void {
  seen.clear();
}
