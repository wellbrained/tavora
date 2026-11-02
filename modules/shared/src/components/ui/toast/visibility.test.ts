// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import { toast, toasts, TOAST_DURATION } from "./toast";
import Toaster from "./Toaster.vue";
import { documentHidden, panelSuspended, setWindowBehind, toastsPaused, trackDocumentVisibility, trackPanelSuspension, windowBehind, type VisibilityTarget } from "./visibility";

// A toast that runs out while nobody can see the panel is a toast nobody read: its time stands still until it is seen.

class FakeDocument implements VisibilityTarget {
  visibilityState = "visible";
  private listeners = new Set<() => void>();
  addEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.delete(listener);
  }
  show(state: "visible" | "hidden") {
    this.visibilityState = state;
    for (const listener of this.listeners) listener();
  }
  get count() {
    return this.listeners.size;
  }
}

afterEach(() => {
  documentHidden.value = false;
  panelSuspended.value = false;
  windowBehind.value = false;
});

describe("following the page", () => {
  it("is paused while the page is hidden, and starts again when it is shown", () => {
    const doc = new FakeDocument();
    const stop = trackDocumentVisibility(doc);
    expect(toastsPaused.value).toBe(false);
    doc.show("hidden");
    expect(toastsPaused.value).toBe(true);
    doc.show("visible");
    expect(toastsPaused.value).toBe(false);
    stop();
    expect(doc.count).toBe(0);
  });

  it("starts out paused when the page is already hidden, and stopping lets go", () => {
    const doc = new FakeDocument();
    doc.visibilityState = "hidden";
    const stop = trackDocumentVisibility(doc);
    expect(toastsPaused.value).toBe(true);
    stop();
    expect(toastsPaused.value).toBe(false);
  });

  it("is paused while Tavora says the panel is suspended, whatever the page says", () => {
    const handlers = { suspend: [] as (() => void)[], resume: [] as (() => void)[] };
    const stop = trackPanelSuspension({
      onSuspend: (fn) => (handlers.suspend.push(fn), () => {}),
      onResume: (fn) => (handlers.resume.push(fn), () => {}),
    });
    handlers.suspend.forEach((fn) => fn());
    expect(toastsPaused.value).toBe(true);
    handlers.resume.forEach((fn) => fn());
    expect(toastsPaused.value).toBe(false);
    handlers.suspend.forEach((fn) => fn());
    stop();
    expect(toastsPaused.value).toBe(false);
  });

  it("is paused while the window is behind the game (the page is not hidden then), for the host page and for a module panel", () => {
    setWindowBehind(true);
    expect(toastsPaused.value).toBe(true);
    setWindowBehind(false);
    expect(toastsPaused.value).toBe(false);

    let behind: (value: boolean) => void = () => {};
    const stopped = vi.fn();
    const stop = trackPanelSuspension({
      onSuspend: () => () => {},
      onResume: () => () => {},
      onBehindChange: (fn) => ((behind = fn), stopped),
    });
    behind(true);
    expect(toastsPaused.value).toBe(true);
    behind(false);
    expect(toastsPaused.value).toBe(false);
    behind(true);
    stop();
    expect(stopped).toHaveBeenCalled();
    expect(toastsPaused.value).toBe(false);
  });

  it("a panel from a Tavora without onBehindChange just never says it is behind", () => {
    const stop = trackPanelSuspension({ onSuspend: () => () => {}, onResume: () => () => {} });
    expect(toastsPaused.value).toBe(false);
    stop();
  });

  it("both sources count: it runs only when the page is shown and the panel is not suspended", () => {
    documentHidden.value = true;
    panelSuspended.value = true;
    documentHidden.value = false;
    expect(toastsPaused.value).toBe(true);
    panelSuspended.value = false;
    expect(toastsPaused.value).toBe(false);
  });
});

describe("a Toaster while the page is hidden", () => {
  let app: App | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
  });

  async function mount() {
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp({ render: () => h(Toaster) });
    app.mount(root);
    await nextTick();
  }

  it("keeps a toast past its time while hidden, and lets it go after it is shown again", async () => {
    await mount();
    toast({ title: "Saved" });
    await nextTick();
    vi.advanceTimersByTime(TOAST_DURATION - 1000);
    expect(toasts.value).toHaveLength(1);

    documentHidden.value = true;
    await nextTick();
    vi.advanceTimersByTime(TOAST_DURATION * 5);
    expect(toasts.value).toHaveLength(1);

    documentHidden.value = false;
    await nextTick();
    vi.advanceTimersByTime(TOAST_DURATION);
    expect(toasts.value).toHaveLength(0);
  });

  it("a toast that arrives while hidden starts its time when the page is shown", async () => {
    await mount();
    documentHidden.value = true;
    toast({ title: "While away" });
    await nextTick();
    vi.advanceTimersByTime(TOAST_DURATION * 5);
    expect(toasts.value).toHaveLength(1);

    documentHidden.value = false;
    await nextTick();
    vi.advanceTimersByTime(TOAST_DURATION - 1);
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts.value).toHaveLength(0);
  });

  it("holds a toast while the window is behind the game, and gives it at least a second when the user is back", async () => {
    await mount();
    toast({ title: "Layout deleted" });
    await nextTick();
    vi.advanceTimersByTime(TOAST_DURATION - 200);
    expect(toasts.value).toHaveLength(1);

    setWindowBehind(true);
    await nextTick();
    vi.advanceTimersByTime(TOAST_DURATION * 5);
    expect(toasts.value).toHaveLength(1);

    setWindowBehind(false);
    await nextTick();
    // Only 200 ms were left; coming back it still has a second to be read and undone.
    vi.advanceTimersByTime(999);
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts.value).toHaveLength(0);
  });

  it("follows the real document too", async () => {
    await mount();
    toast({ title: "Saved" });
    await nextTick();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await nextTick();
    vi.advanceTimersByTime(TOAST_DURATION * 2);
    expect(toasts.value).toHaveLength(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await nextTick();
    vi.advanceTimersByTime(TOAST_DURATION);
    expect(toasts.value).toHaveLength(0);
  });
});
