// A small in-memory limit per client, so one PC cannot hammer the service.
// Nothing about the request is kept except a counter and a time.

export interface RateLimiter {
  /** Seconds to wait when over the limit, or 0 when the request may go on. */
  check(key: string, now?: number): number;
}

export function createRateLimiter(options: { limit: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = 0;
  return {
    check(key, now = Date.now()) {
      if (now - lastSweep > options.windowMs) {
        lastSweep = now;
        for (const [name, entry] of hits) if (entry.resetAt <= now) hits.delete(name);
      }
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + options.windowMs });
        return 0;
      }
      entry.count += 1;
      return entry.count > options.limit ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 0;
    },
  };
}
