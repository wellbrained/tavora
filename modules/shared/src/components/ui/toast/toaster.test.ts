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
  return () => document.querySelector("[role=status]")!.textContent ?? "";
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

describe("Toaster morph", () => {
  const observed = new Map<Element, (entries: unknown[]) => void>();
  const original = globalThis.ResizeObserver;
  beforeEach(() => {
    observed.clear();
    globalThis.ResizeObserver = class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe(target: Element) {
        observed.set(target, this.callback);
      }
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  const mountIn = () => {
    const root = document.createElement("div");
    document.body.append(root);
    app = createApp({ render: () => h(Toaster) });
    app.mount(root);
    return root;
  };
  const pill = (_root: HTMLElement, id: number) => document.querySelector<HTMLElement>(`[data-id="${id}"] .tavora-toast`)!;
  /** What the browser would say about a toast's content once it laid it out. */
  const measure = (root: HTMLElement, id: number, width: number, height: number) => {
    const content = document.querySelector(`[data-id="${id}"] .tavora-toast-content`)!;
    observed.get(content)!([{ borderBoxSize: [{ inlineSize: width, blockSize: height }] }]);
  };

  it("brings a new front toast in at the size of the one in front, then at its own", async () => {
    const root = mountIn();
    const first = toast({ title: "Saving…" });
    await nextTick();
    // Nothing in front before it: it comes in at its own size.
    expect(pill(root, first.id).style.width).toBe("");
    measure(root, first.id, 200, 44);
    await nextTick();
    expect(pill(root, first.id).style.width).toBe("200px");

    const second = toast({ title: "Layout deleted", action: { label: "Undo", onClick: () => undefined } });
    await nextTick();
    // The first frame is the old size, so the width/height transition has something to spring from.
    expect([pill(root, second.id).style.width, pill(root, second.id).style.height]).toEqual(["200px", "44px"]);
    // The one behind keeps its size too; it does not snap to a size the new toast does not have yet.
    expect(pill(root, first.id).style.width).toBe("200px");

    measure(root, second.id, 320, 56);
    await nextTick();
    expect([pill(root, second.id).style.width, pill(root, second.id).style.height]).toEqual(["320px", "56px"]);
    // The collapsed one behind follows it (its own width/height transition runs along).
    expect([pill(root, first.id).style.width, pill(root, first.id).style.height]).toEqual(["320px", "56px"]);
  });

  it("starts a third toast from the second, and a toast after an empty stack at its own size", async () => {
    const root = mountIn();
    const first = toast({ title: "One" });
    await nextTick();
    measure(root, first.id, 180, 44);
    const second = toast({ title: "Two" });
    await nextTick();
    measure(root, second.id, 260, 44);
    const third = toast({ title: "Three" });
    await nextTick();
    expect(pill(root, third.id).style.width).toBe("260px");

    toasts.value = [];
    await nextTick();
    const fresh = toast({ title: "Fresh" });
    await nextTick();
    expect(pill(root, fresh.id).style.width).toBe("");
  });
});

describe("Toaster in the Tab order", () => {
  const mountAt = (position: "bottom-center" | "top-center") => {
    const root = document.createElement("div");
    root.innerHTML = '<button id="before">Before</button>';
    document.body.append(root);
    const inner = document.createElement("div");
    root.append(inner);
    app = createApp({ render: () => h(Toaster, { position }) });
    app.mount(inner);
    root.insertAdjacentHTML("beforeend", '<button id="after">After</button>');
    return root;
  };
  const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("comes after the page when it is drawn at the bottom, wherever it was mounted", async () => {
    mountAt("bottom-center");
    toast({ title: "Saved" });
    await nextTick();
    const toaster = document.querySelector("[data-slot=toaster]")!;
    expect(follows(document.getElementById("after")!, toaster)).toBe(true);
    expect(toaster.closest("[data-slot=toaster-host]")?.parentElement).toBe(document.body);
    expect(document.body.lastElementChild).toBe(toaster.closest("[data-slot=toaster-host]"));
  });

  it("comes before the page when it is drawn at the top, and lists the newest first", async () => {
    mountAt("top-center");
    toast({ title: "First" });
    toast({ title: "Second" });
    await nextTick();
    const toaster = document.querySelector("[data-slot=toaster]")!;
    expect(follows(toaster, document.getElementById("before")!)).toBe(true);
    const titles = [...toaster.querySelectorAll(".tavora-toast-title")].map((p) => p.textContent);
    expect(titles).toEqual(["Second", "First"]);
  });

  it("lists the oldest first at the bottom, where the newest is drawn lowest", async () => {
    mountAt("bottom-center");
    toast({ title: "First" });
    toast({ title: "Second" });
    await nextTick();
    const titles = [...document.querySelectorAll(".tavora-toast-title")].map((p) => p.textContent);
    expect(titles).toEqual(["First", "Second"]);
  });

  it("leaves nothing behind when it goes", async () => {
    mountAt("bottom-center");
    await nextTick();
    app?.unmount();
    app = undefined;
    expect(document.querySelector("[data-slot=toaster-host]")).toBeNull();
  });

  it("takes no Tab stop on a toast that is leaving", async () => {
    mountAt("bottom-center");
    const shown = toast({ title: "Going" });
    await nextTick();
    shown.dismiss();
    await nextTick();
    // jsdom has no transitions, so the slot may be gone already; if it is still there it is inert.
    const left = document.querySelector<HTMLElement>(".tavora-toast-slot");
    if (left) expect(left.getAttribute("inert")).toBe("");
  });
});
