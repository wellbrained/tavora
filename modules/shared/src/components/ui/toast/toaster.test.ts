// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import { dismissToast, toast, toasts } from "./toast";
import Toaster from "./Toaster.vue";

// Screen readers hear a toast once, when it arrives (and again only when its content changes), through the Toaster's
// live region. ResizeObserver is not in jsdom; the toasts only need it for their size.
let app: App | undefined;
beforeEach(() => {
  toasts.value = [];
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
  toasts.value = [];
});

function mount(): () => string {
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp({ render: () => h(Toaster) });
  app.mount(root);
  return () => root.querySelector("[role=status]")!.textContent ?? "";
}

describe("Toaster live region", () => {
  it("reads a new toast once and does not read the one behind it again when it leaves", async () => {
    const status = mount();
    toast({ title: "Layout deleted" });
    await nextTick();
    expect(status()).toBe("Layout deleted");
    const second = toast({ title: "Frame deleted" });
    await nextTick();
    expect(status()).toBe("Frame deleted");
    second.dismiss();
    await nextTick();
    // Unchanged: nothing new is read out.
    expect(status()).toBe("Frame deleted");
    dismissToast(toasts.value[0]!.id);
    await nextTick();
    expect(status()).toBe("Frame deleted");
  });

  it("reads the same words twice when two toasts say the same", async () => {
    const status = mount();
    toast({ title: "To-do deleted" });
    await nextTick();
    const first = status();
    toast({ title: "To-do deleted" });
    await nextTick();
    expect(status()).not.toBe(first);
    expect(status().trim()).toBe("To-do deleted");
  });

  it("reads a toast again when its content changes", async () => {
    const status = mount();
    const shown = toast({ title: "Saving…", variant: "loading" });
    await nextTick();
    shown.update({ title: "Saved", variant: "success" });
    await nextTick();
    expect(status()).toBe("Saved");
  });
});

describe("Toaster in a page of its own", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps every toast's time while it is paused, and starts it when it is not", async () => {
    vi.useFakeTimers();
    const paused = ref(true);
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp({ render: () => h(Toaster, { paused: paused.value }) });
    app.mount(root);
    toast({ title: "Saved" });
    await nextTick();
    vi.advanceTimersByTime(60_000);
    expect(toasts.value).toHaveLength(1);
    paused.value = false;
    await nextTick();
    vi.advanceTimersByTime(5_100);
    expect(toasts.value).toHaveLength(0);
  });

  it("says how much room the spread-out stack needs", async () => {
    const extents: { width: number; height: number }[] = [];
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp({ render: () => h(Toaster, { onExtent: (value: { width: number; height: number }) => extents.push(value) }) });
    app.mount(root);
    await nextTick();
    expect(extents.at(-1)).toEqual({ width: 0, height: 0 });
    toast({ title: "One" });
    toast({ title: "Two" });
    await nextTick();
    // Neither is measured here (no layout in jsdom): the default height counts, with the gap between.
    expect(extents.at(-1)!.height).toBe(44 * 2 + 8);
    toasts.value = [];
    await nextTick();
    expect(extents.at(-1)).toEqual({ width: 0, height: 0 });
  });
});
