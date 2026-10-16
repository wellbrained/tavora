// Measures a message from a module before it is passed on. It runs inside the
// module's own renderer (preload/relay.ts), so a module that sends something
// huge or strange can only hurt itself, never the main process.

/** The deepest nesting accepted; the same limit the host applies to stored values. */
export const MAX_WIRE_DEPTH = 64;

export type WireMeasure = { ok: true; bytes: number } | { ok: false; reason: "not-json" | "too-large" };

/**
 * Walks a received message and counts roughly how many characters its JSON
 * text would have, giving up as soon as `limit` is passed. Only plain JSON
 * data is accepted: no Dates, Maps, typed arrays or ArrayBuffers (those can
 * be large while looking tiny to JSON.stringify), no NaN, no class instances,
 * no cycles (too deep).
 */
export function measureWire(value: unknown, limit: number): WireMeasure {
  let bytes = 0;
  const walk = (item: unknown, depth: number): "not-json" | "too-large" | null => {
    if (depth > MAX_WIRE_DEPTH) return "not-json";
    // undefined carries no data (JSON drops it); the handlers still refuse it where a value is required.
    if (item === undefined) return null;
    if (item === null || typeof item === "boolean") bytes += 5;
    else if (typeof item === "string") bytes += item.length + 2;
    else if (typeof item === "number") {
      if (!Number.isFinite(item)) return "not-json";
      bytes += String(item).length;
    } else if (Array.isArray(item)) {
      bytes += 2;
      for (const entry of item) {
        bytes += 1;
        if (bytes > limit) return "too-large";
        const problem = walk(entry, depth + 1);
        if (problem) return problem;
      }
    } else if (typeof item === "object") {
      const proto = Object.getPrototypeOf(item);
      // Plain objects only. Their prototype is the (possibly other realm's) Object.prototype, whose own prototype is null.
      if (proto !== null && Object.getPrototypeOf(proto) !== null) return "not-json";
      bytes += 2;
      for (const key of Object.keys(item)) {
        bytes += key.length + 4;
        if (bytes > limit) return "too-large";
        const problem = walk((item as Record<string, unknown>)[key], depth + 1);
        if (problem) return problem;
      }
    } else {
      return "not-json";
    }
    return bytes > limit ? "too-large" : null;
  };
  const problem = walk(value, 0);
  return problem ? { ok: false, reason: problem } : { ok: true, bytes };
}
