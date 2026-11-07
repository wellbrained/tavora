import { createViewMemory, type ViewStore } from "@tavora/official-ui/components/ui/zoom-pane";
import { flushViewMemory } from "@tavora/official-ui";
import { createMemoryHost } from "@tavora/sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { flushViewsOnLifecycle } from "./lifecycleFlush";

const fakeStore = () => {
  const set = vi.fn(async () => undefined);
  const store: ViewStore = { get: async () => null, set };
  return { store, set };
};

describe("flushViewsOnLifecycle", () => {
  it("writes a view that is still waiting when the panel is suspended", async () => {
    const { host, sdk } = createMemoryHost();
    const { store, set } = fakeStore();
    const memory = createViewMemory("playground-line", { store, delay: 60_000 });
    flushViewsOnLifecycle(sdk.lifecycle);
    memory.save({ x: 10, y: 20, zoom: 2 });
    expect(set).not.toHaveBeenCalled();
    host.suspend();
    await flushViewMemory();
    expect(set).toHaveBeenCalledWith("zoom-view:playground-line", { x: 10, y: 20, zoom: 2 });
  });

  it("writes it when the panel is closed", async () => {
    const { host, sdk } = createMemoryHost();
    const { store, set } = fakeStore();
    const memory = createViewMemory("playground-island", { store, delay: 60_000 });
    flushViewsOnLifecycle(sdk.lifecycle);
    memory.save({ x: 1, y: 2, zoom: 1 });
    host.dispose();
    await flushViewMemory();
    expect(set).toHaveBeenCalledTimes(1);
  });
});
