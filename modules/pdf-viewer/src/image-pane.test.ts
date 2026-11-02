// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import ImagePane from "./ImagePane.vue";

// A picture in the kit's zoom pane: its zoom is saved (a document edit) whenever it changes, so a glide of the pane's
// Whole map button must save once, when it has settled, never on each of its frames.

let app: App | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) {}
    observe() {
      this.callback();
    }
    disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 300 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = async () => {
  for (let step = 0; step < 5; step++) await nextTick();
};

describe("ImagePane", () => {
  it("saves the zoom once a glide to the whole picture has settled, not on every frame", async () => {
    const saved = vi.fn();
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp(defineComponent({ render: () => h(ImagePane, { url: "x.png", name: "x.png", view: { page: 1, zoom: 1, fit: "page", side: null }, onView: saved }) }));
    app.mount(root);
    const image = root.querySelector("[data-testid=image-view]") as HTMLImageElement;
    Object.defineProperty(image, "naturalWidth", { value: 800 });
    Object.defineProperty(image, "naturalHeight", { value: 600 });
    image.dispatchEvent(new Event("load"));
    // It waits two frames for the pane to measure itself: one at a time, since the second is asked for after the first.
    for (let frame = 0; frame < 4; frame++) {
      vi.advanceTimersByTime(20);
      await flush();
    }

    const button = (id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement;
    button("zoom-in").click();
    button("zoom-in").click();
    await flush();
    expect(saved).toHaveBeenCalled();
    saved.mockClear();

    button("zoom-whole").click();
    vi.advanceTimersByTime(150);
    await flush();
    // Mid-glide: the view changes on each frame, and nothing is written yet.
    expect(saved).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    await flush();
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0]![0]).toMatchObject({ fit: "page" });
  });

  it("says Show the whole picture on its Whole map button", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp(defineComponent({ render: () => h(ImagePane, { url: "x.png", name: "x.png", view: { page: 1, zoom: 1, fit: "page", side: null } }) }));
    app.mount(root);
    await flush();
    expect((root.querySelector("[data-testid=zoom-whole]") as HTMLElement).getAttribute("aria-label")).toBe("Show the whole picture");
  });
});
