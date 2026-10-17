import { describe, expect, it } from "vitest";
import { clientOf, createRateLimiter } from "./rate-limit.ts";

describe("clientOf", () => {
  it("keeps an IPv4 address and counts IPv6 by its /64", () => {
    expect(clientOf("203.0.113.7")).toBe("203.0.113.7");
    expect(clientOf("2001:db8:c013:d350::1")).toBe("2001:db8:c013:d350::/64");
    expect(clientOf("2001:0db8:c013:d350:ffff:1:2:3")).toBe("2001:db8:c013:d350::/64");
    expect(clientOf("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientOf("[2001:db8:c013:d350::abcd]")).toBe("2001:db8:c013:d350::/64");
    expect(clientOf("::ffff:198.51.100.4")).toBe("198.51.100.4");
  });

  it("gives every address of one /64 the same key", () => {
    const keys = new Set(["2001:db8:1:2::1", "2001:db8:1:2:aaaa::9", "2001:db8:1:2:ffff:ffff:ffff:ffff"].map(clientOf));
    expect(keys.size).toBe(1);
    expect(clientOf("2001:db8:1:3::1")).not.toBe(clientOf("2001:db8:1:2::1"));
  });

  it("refuses what is not an address", () => {
    expect(clientOf(undefined)).toBeNull();
    expect(clientOf("")).toBeNull();
    expect(clientOf("not-an-ip")).toBeNull();
  });
});

describe("createRateLimiter", () => {
  it("never keeps more clients than its cap", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxClients: 3 });
    for (const key of ["a", "b", "c", "d", "e"]) expect(limiter.check(key, 1000)).toBe(0);
    // The oldest were forgotten to make room; the newest are still counted.
    expect(limiter.check("e", 1000)).toBeGreaterThan(0);
    expect(limiter.check("a", 1000)).toBe(0);
  });
});
