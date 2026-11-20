import { describe, expect, it } from "vitest";
import { checkAll, clientOf, createRateLimiter, networkOf } from "./rate-limit.ts";

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

describe("networkOf", () => {
  it("widens a client to its IPv4 /24 or IPv6 /48, and leaves other keys alone", () => {
    expect(networkOf("203.0.113.77")).toBe("203.0.113.0/24");
    expect(networkOf(clientOf("2001:db8:1:2:3:4:5:6")!)).toBe("2001:db8:1::/48");
    expect(networkOf(clientOf("2001:db8:1:ffff::1")!)).toBe(networkOf(clientOf("2001:db8:1:2::1")!));
    expect(networkOf("shared")).toBe("shared");
    expect(networkOf("local")).toBe("local");
  });
});

describe("createRateLimiter", () => {
  it("peeks without counting, and checks several limits all or none", () => {
    const one = createRateLimiter({ limit: 1, windowMs: 1000 });
    const two = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(one.peek("a", 0)).toBe(0);
    expect(one.peek("a", 0)).toBe(0);
    expect(checkAll([[one, "a"], [two, "a"]], 0)).toBe(0);
    expect(one.peek("a", 0)).toBe(1);
    // One refuses: the other counts nothing.
    expect(checkAll([[one, "a"], [two, "a"]], 0)).toBe(1);
    expect(checkAll([[two, "a"]], 0)).toBe(0);
    expect(two.peek("a", 0)).toBe(1);
    expect(one.peek("a", 1000)).toBe(0);
  });

  it("never keeps more clients than its cap", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxClients: 3 });
    for (const key of ["a", "b", "c", "d", "e"]) expect(limiter.check(key, 1000)).toBe(0);
    // The oldest were forgotten to make room; the newest are still counted.
    expect(limiter.check("e", 1000)).toBeGreaterThan(0);
    expect(limiter.check("a", 1000)).toBe(0);
  });
});
