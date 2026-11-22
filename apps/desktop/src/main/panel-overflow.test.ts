// @vitest-environment jsdom
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

  it("counts only what scrolls more since the last look", async () => {
    // The script runs here against a page with boxes given by hand (jsdom has no layout): a list that always scrolls 900,
    // and a details part that fits until its panel is made smaller.
    const sized = (overflowY: string, scrollHeight: number) => {
      const el = document.createElement("div");
      el.style.overflowY = overflowY;
      Object.defineProperty(el, "clientHeight", { configurable: true, value: 300 });
      Object.defineProperty(el, "clientWidth", { configurable: true, value: 300 });
      Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
      Object.defineProperty(el, "scrollWidth", { configurable: true, value: 300 });
      document.body.append(el);
      return el;
    };
    sized("auto", 1200);
    const details = sized("auto", 300);
    sized("hidden", 5000);
    // oxlint-disable-next-line no-eval -- runs the very script a panel page would run
    const run = vi.fn(async (_world: number, scripts: { code: string }[]) => (0, eval)(scripts[0]!.code) as unknown);
    state.contents = { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: run };
    try {
      await expect(panelOverflow(7)).resolves.toEqual({ x: 0, y: 900 });
      await expect(panelOverflow(7, "since")).resolves.toEqual({ x: 0, y: 0 });
      Object.defineProperty(details, "scrollHeight", { configurable: true, value: 420 });
      await expect(panelOverflow(7, "since")).resolves.toEqual({ x: 0, y: 120 });
    } finally {
      document.body.replaceChildren();
    }
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
