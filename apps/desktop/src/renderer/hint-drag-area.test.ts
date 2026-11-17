// @vitest-environment jsdom
// A hover hint floats like a menu (the panels step aside for it), but it leaves the header's drag areas as they are:
// switching them under a resting pointer makes Windows tell the page the pointer left and came back, and a hint on the
// header closed and opened again. The real host.ts runs on a stand-in for the main process.
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const bridge = vi.hoisted(() => {
  const setOverlay = vi.fn();
  // Every listener is taken and never called, every other call answers nothing.
  const api = new Proxy({} as Record<string, unknown>, {
    get: (_, key) => (key === "setOverlay" ? setOverlay : typeof key === "string" && key.startsWith("on") ? () => () => undefined : () => Promise.resolve(null)),
  });
  (window as unknown as { tavoraHost: unknown }).tavoraHost = api;
  document.elementsFromPoint ??= () => [];
  if (!("PerformanceObserver" in globalThis)) (globalThis as Record<string, unknown>).PerformanceObserver = class { observe() {} disconnect() {} };
  return { setOverlay };
});

const { setHintFloating, overlayOpen, dragging } = await import("./host");
const floating = () => document.documentElement.classList.contains("floating-open");
const tick = async () => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("a hover hint and the header's drag areas", () => {
  it("sets the panels aside for a hint but keeps the drag areas", async () => {
    setHintFloating(true);
    await tick();
    expect(overlayOpen.value).toBe(true);
    expect(bridge.setOverlay).toHaveBeenLastCalledWith(true);
    expect(floating()).toBe(false);
  });

  it("still lets clicks through the drag areas for a drag (or a menu or dialog) while a hint is out", async () => {
    dragging.value = "panel";
    await tick();
    expect(floating()).toBe(true);
    dragging.value = null;
    await tick();
    expect(floating()).toBe(false);
    expect(overlayOpen.value).toBe(true);
  });
});
