import { isIP } from "node:net";

// A small in-memory limit per client, so one PC cannot hammer the service.
// Nothing about the request is kept except a counter and a time.

export interface RateLimiter {
  /** Seconds to wait when over the limit, or 0 when the request may go on. */
  check(key: string, now?: number): number;
}

/** Clients counted at once; past this the oldest go first, so a flood of new keys cannot fill the memory. */
export const MAX_CLIENTS = 100_000;

export function createRateLimiter(options: { limit: number; windowMs: number; maxClients?: number }): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const maxClients = options.maxClients ?? MAX_CLIENTS;
  let lastSweep = 0;
  const sweep = (now: number) => {
    lastSweep = now;
    for (const [name, entry] of hits) if (entry.resetAt <= now) hits.delete(name);
  };
  return {
    check(key, now = Date.now()) {
      if (now - lastSweep > options.windowMs) sweep(now);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        if (!entry && hits.size >= maxClients) {
          sweep(now);
          // Still full: forget the oldest, which a Map keeps first.
          for (const name of hits.keys()) {
            if (hits.size < maxClients) break;
            hits.delete(name);
          }
        }
        hits.set(key, { count: 1, resetAt: now + options.windowMs });
        return 0;
      }
      entry.count += 1;
      return entry.count > options.limit ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 0;
    },
  };
}

/**
 * Who a request counts as for the limits: an IPv4 address as it is, an IPv6 address by its /64
 * network, since one connection gets a whole /64 and could otherwise use a new address per request.
 * IPv4 written inside IPv6 (::ffff:a.b.c.d) counts as that IPv4 address.
 */
export function clientOf(address: string | undefined): string | null {
  const text = address?.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "") ?? "";
  const family = isIP(text);
  if (family === 4) return text;
  if (family !== 6) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(text);
  if (mapped) return mapped[1]!;
  return `${expandIpv6(text).slice(0, 4).join(":")}::/64`;
}

/** The eight groups of an IPv6 address, without leading zeros. */
function expandIpv6(address: string): string[] {
  let text = address.toLowerCase();
  // A dotted IPv4 tail becomes its two groups.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split("::") as [string, string | undefined];
  const left = head ? head.split(":") : [];
  const right = rest === undefined ? [] : rest ? rest.split(":") : [];
  const groups = rest === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return groups.map((group) => parseInt(group || "0", 16).toString(16));
}
