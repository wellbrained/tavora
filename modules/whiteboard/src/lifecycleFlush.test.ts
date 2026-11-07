import { createMemoryHost } from "@tavora/sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { flushOnLifecycle } from "./lifecycleFlush";

describe("flushOnLifecycle", () => {
  it("flushes when the panel is suspended and when it is disposed", () => {
    const { host, sdk } = createMemoryHost();
    const flush = vi.fn();
    flushOnLifecycle(sdk.lifecycle, flush);
    host.suspend();
    expect(flush).toHaveBeenCalledTimes(1);
    host.dispose();
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("stops flushing once it is let go", () => {
    const { host, sdk } = createMemoryHost();
    const flush = vi.fn();
    flushOnLifecycle(sdk.lifecycle, flush)();
    host.suspend();
    expect(flush).not.toHaveBeenCalled();
  });

  it("does not throw when saving fails", async () => {
    const { host, sdk } = createMemoryHost();
    flushOnLifecycle(sdk.lifecycle, () => Promise.reject(new Error("nope")));
    expect(() => host.suspend()).not.toThrow();
    await Promise.resolve();
  });
});
