import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ contents: undefined as unknown }));
vi.mock("electron", () => ({ webContents: { fromId: () => state.contents } }));

import { MAX_OVERFLOW_PX, checkOverflow, panelOverflow } from "./panel-overflow";

describe("checkOverflow", () => {
  it("keeps whole numbers in range", () => {
    expect(checkOverflow({ x: 12.2, y: 40 })).toEqual({ x: 13, y: 40 });
    expect(checkOverflow({ x: -5, y: 1e9 })).toEqual({ x: 0, y: MAX_OVERFLOW_PX });
  });

  it("reads anything else as nothing to fit", () => {
    expect(checkOverflow(null)).toEqual({ x: 0, y: 0 });
    expect(checkOverflow({ x: "100", y: Number.NaN })).toEqual({ x: 0, y: 0 });
    expect(checkOverflow("{x:1}")).toEqual({ x: 0, y: 0 });
  });
});

describe("panelOverflow", () => {
  beforeEach(() => {
    state.contents = undefined;
  });

  it("measures the page in a world of its own", async () => {
    const run = vi.fn(async (_world: number, _scripts: unknown) => ({ x: 0, y: 120 }));
    state.contents = { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: run };
    await expect(panelOverflow(7)).resolves.toEqual({ x: 0, y: 120 });
    expect(run.mock.calls[0]![0]).not.toBe(0);
  });

  it("gives nothing for a page that is gone, fails or never answers", async () => {
    await expect(panelOverflow(7)).resolves.toEqual({ x: 0, y: 0 });
    state.contents = { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: async () => Promise.reject(new Error("crashed")) };
    await expect(panelOverflow(7)).resolves.toEqual({ x: 0, y: 0 });
    vi.useFakeTimers();
    try {
      state.contents = { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: () => new Promise(() => {}) };
      const pending = panelOverflow(7);
      await vi.advanceTimersByTimeAsync(600);
      await expect(pending).resolves.toEqual({ x: 0, y: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});
