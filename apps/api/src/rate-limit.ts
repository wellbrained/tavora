import { isIP } from "node:net";

// A small in-memory limit per client, so one PC cannot hammer the service.
// Nothing about the request is kept except a counter and a time.

export interface RateLimiter {
  /** Seconds to wait when over the limit, or 0 when the request may go on. `cost`: how many it counts as (1 by default). */
  check(key: string, now?: number, cost?: number): number;
  /** What check() would answer now, without counting anything. */
  peek(key: string, now?: number, cost?: number): number;
}

/**
 * Several limits for one request, all or none: 0 and each one counted when every limit lets it through, or the longest
 * wait, counting nothing, so a refusal by one doesn't use up the others. A limit may name what the request costs in it
 * (1 by default), for a request that leads to several emails.
 */
export function checkAll(limits: [RateLimiter, string, number?][], now?: number): number {
  const wait = Math.max(0, ...limits.map(([limiter, key, cost]) => limiter.peek(key, now, cost)));
  if (wait > 0) return wait;
  for (const [limiter, key, cost] of limits) limiter.check(key, now, cost);
  return 0;
}

/** Clients counted at once; past this the oldest go first, so a flood of new keys cannot fill the memory. */
export const MAX_CLIENTS = 100_000;

export function createRateLimiter(options: { limit: number; windowMs: number; maxClients?: number }): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const maxClients = options.maxClients ?? MAX_CLIENTS;
  let lastSweep = 0;
  /** A first request is always let through, as one; one that counts as more than the limit holds is not. */
  const over = (cost: number) => cost > 1 && cost > options.limit;
  return {
    check(key, now = Date.now(), cost = 1) {
      if (now - lastSweep > options.windowMs) {
        lastSweep = now;
        for (const [name, entry] of hits) if (entry.resetAt <= now) hits.delete(name);
      }
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        // Full: forget the oldest, which a Map keeps first. No sweep here, so a flood of new keys costs
        // one deletion each, never a pass over every client; the regular sweep above still runs once a window.
        if (!entry && hits.size >= maxClients) hits.delete(hits.keys().next().value!);
        hits.set(key, { count: cost, resetAt: now + options.windowMs });
        return over(cost) ? Math.max(1, Math.ceil(options.windowMs / 1000)) : 0;
      }
      entry.count += cost;
      return entry.count > options.limit ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 0;
    },
    peek(key, now = Date.now(), cost = 1) {
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) return over(cost) ? Math.max(1, Math.ceil(options.windowMs / 1000)) : 0;
      return entry.count + cost > options.limit ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 0;
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

/**
 * A wider network for a client key from clientOf: an IPv4 address's /24 and an IPv6 /64's /48, for limits one person never
 * reaches but one network handing out many addresses would. Any other key (a test's, "shared") stays as it is.
 */
export function networkOf(client: string): string {
  const v4 = /^(\d+\.\d+\.\d+)\.\d+$/.exec(client);
  if (v4) return `${v4[1]}.0/24`;
  const v6 = /^([0-9a-f]+:[0-9a-f]+:[0-9a-f]+):[0-9a-f]+::\/64$/.exec(client);
  return v6 ? `${v6[1]}::/48` : client;
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
