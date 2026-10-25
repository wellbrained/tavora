import dns from "node:dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { icmpAddress, loadNative, windowsConnectionProbe } from "./connection-windows";

afterEach(() => vi.restoreAllMocks());

describe("loading Windows' functions", () => {
  const library = (missing: string[]) => ({
    load: () => ({
      func: (signature: string) => {
        if (missing.some((name) => signature.includes(name))) throw new Error("function not found");
        return () => 0;
      },
    }),
  });

  it("goes on without GetNetworkConnectivityHint, as an older Windows needs", () => {
    const native = loadNative(library(["GetNetworkConnectivityHint"]) as never);
    expect(native.hint).toBeNull();
    expect(native.icmpSend).toBeTypeOf("function");
    expect(native.bestRoute).toBeTypeOf("function");
  });

  it("has the hint when Windows has it", () => {
    expect(loadNative(library([]) as never).hint).toBeTypeOf("function");
  });

  it("still fails when a function every Windows has is missing, and tries to load only once", () => {
    const loader = vi.fn(() => {
      throw new Error("no iphlpapi");
    });
    const probe = windowsConnectionProbe(loader);
    for (let i = 0; i < 4; i++) expect(() => probe.local()).toThrow("no iphlpapi");
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("pings", () => {
  it("writes the address with the first number lowest", () => {
    expect(icmpAddress("1.2.3.4")).toBe(0x04030201);
    expect(icmpAddress("nope")).toBeNull();
  });

  it("never fails a ping when the library is missing", async () => {
    const probe = windowsConnectionProbe(() => {
      throw new Error("no iphlpapi");
    });
    await expect(probe.ping("internet", "1.1.1.1", 1000)).resolves.toBeNull();
  });
});

describe("name lookups", () => {
  it("has at most one in flight, even when the name server hangs", async () => {
    vi.useFakeTimers();
    try {
      const lookup = vi.spyOn(dns.promises, "lookup").mockImplementation(() => new Promise(() => undefined));
      const probe = windowsConnectionProbe(() => {
        throw new Error("not needed");
      });
      const first = probe.resolve("a.example.com");
      await vi.advanceTimersByTimeAsync(2500);
      await expect(first).resolves.toBeNull();
      // The first lookup is still out: the next ones don't start another.
      await expect(probe.resolve("b.example.com")).resolves.toBeNull();
      await expect(probe.resolve("c.example.com")).resolves.toBeNull();
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("looks up again once the last one is over", async () => {
    const lookup = vi.spyOn(dns.promises, "lookup").mockResolvedValue({ address: "93.184.216.34", family: 4 } as never);
    const probe = windowsConnectionProbe(() => {
      throw new Error("not needed");
    });
    await expect(probe.resolve("a.example.com")).resolves.toBe("93.184.216.34");
    await expect(probe.resolve("a.example.com")).resolves.toBe("93.184.216.34");
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
