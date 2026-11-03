import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What the main process does when the toast page fails: say so, keep the toasts' time itself, load the page once more, and
// when that fails too let the host page show the toasts.
const made = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  const state = {
    contents: null as null | { id: number; handlers: Map<string, Listener>; loads: number; failLoads: boolean; destroyed: boolean },
    ipc: new Map<string, Listener[]>(),
  };
  return state;
});

vi.mock("electron", () => {
  class WebContentsView {
    webContents = {
      id: 7,
      handlers: new Map<string, (...args: unknown[]) => void>(),
      loads: 0,
      failLoads: false,
      destroyed: false,
      setWindowOpenHandler: () => undefined,
      on(event: string, listener: (...args: unknown[]) => void) {
        this.handlers.set(event, listener);
      },
      loadURL(this: { loads: number; failLoads: boolean }) {
        this.loads++;
        return this.failLoads ? Promise.reject(new Error("ERR_FILE_NOT_FOUND")) : Promise.resolve();
      },
      isDestroyed() {
        return this.destroyed;
      },
      isFocused: () => false,
      send: () => undefined,
      close() {
        this.destroyed = true;
      },
    };
    constructor() {
      made.contents = this.webContents as never;
    }
    setBackgroundColor() {}
    setVisible() {}
    setBounds() {}
  }
  const ipcMain = {
    on: (channel: string, listener: (...args: unknown[]) => void) => void made.ipc.set(channel, [...(made.ipc.get(channel) ?? []), listener]),
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => void made.ipc.set(channel, (made.ipc.get(channel) ?? []).filter((entry) => entry !== listener)),
  };
  return { WebContentsView, ipcMain };
});

const { ToastView } = await import("./toast-view");

const READY_MS = 10_000;
const page = () => made.contents!;
const fire = (event: string, ...args: unknown[]) => page().handlers.get(event)!(...args);
const pageSays = (channel: string, ...args: unknown[]) => {
  for (const listener of made.ipc.get(channel) ?? []) listener({ sender: { id: 7 }, senderFrame: { parent: null } }, ...args);
};

let events: { type: string; id: number }[];
let fallback: boolean[];
let errors: { mock: { calls: unknown[][] }; mockRestore(): void; (...args: unknown[]): void } & ReturnType<typeof vi.fn>;
let views: InstanceType<typeof ToastView>[];

function create() {
  const window = {
    contentView: { addChildView: () => undefined, removeChildView: () => undefined },
    getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }),
    on: () => undefined,
    removeListener: () => undefined,
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, focus: () => undefined },
  };
  const view = new ToastView({
    window: window as never,
    preload: "toasts.cjs",
    address: "tavora://app/toasts.html",
    devTools: false,
    theme: () => ({ toasts: "bottom-center", mode: "dark", tokens: {}, radius: 8 }) as never,
    language: () => "en",
    event: (event) => events.push(event),
    fallback: (on) => fallback.push(on),
    readyAfterMs: READY_MS,
  });
  views.push(view);
  return view;
}

const items = (...list: { id: number; duration?: number; action?: string }[]) => list.map((item) => ({ revision: 0, title: `Toast ${item.id}`, ...item }));
const errorText = () => errors.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");

beforeEach(() => {
  vi.useFakeTimers();
  made.ipc.clear();
  events = [];
  fallback = [];
  views = [];
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined) as never;
});
afterEach(() => {
  for (const view of views) view.dispose();
  vi.useRealTimers();
  errors.mockRestore();
});

describe("a toast page that works", () => {
  it("leaves the toasts' time to the page and logs nothing", () => {
    const view = create();
    pageSays("toasts:ready");
    view.sync(items({ id: 1, duration: 3000 }));
    vi.advanceTimersByTime(READY_MS * 5);
    expect(events).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect(fallback).toEqual([]);
  });
});

describe("a toast page that does not load", () => {
  it("logs the error, expires the toasts itself, tries once more and then hands over to the host page", async () => {
    const view = create();
    view.sync(items({ id: 1, duration: 3000, action: "Undo" }, { id: 2, duration: 8000 }, { id: 3, duration: Infinity }));
    fire("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "tavora://app/toasts.html", true);
    expect(errorText()).toContain("the toast page did not load (ERR_FILE_NOT_FOUND)");
    expect(page().loads).toBe(2);
    // The reload fails too.
    page().failLoads = true;
    fire("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "tavora://app/toasts.html", true);
    expect(fallback).toEqual([true]);
    expect(errorText()).toContain("toasts show in the main window instead");
    expect(page().loads).toBe(2);
    // The host page's Toaster has them now and keeps their time; the main process stops the clocks.
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual([]);
  });

  it("still expires queued toasts and settles them while the reload is under way", () => {
    const view = create();
    view.sync(items({ id: 1, duration: 3000, action: "Undo" }, { id: 2, duration: 8000 }, { id: 3, duration: Infinity }));
    fire("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "tavora://app/toasts.html", true);
    vi.advanceTimersByTime(2999);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    // The host page turns this into dismissToast: an Undo nobody pressed ends as not clicked.
    expect(events).toEqual([{ type: "dismiss", id: 1 }]);
    vi.advanceTimersByTime(5000);
    expect(events).toEqual([
      { type: "dismiss", id: 1 },
      { type: "dismiss", id: 2 },
    ]);
  });

  it("takes a page that never says it is ready for a failure", () => {
    const view = create();
    view.sync(items({ id: 1, duration: 3000 }));
    vi.advanceTimersByTime(READY_MS);
    expect(errorText()).toContain("sent no ready signal");
    expect(page().loads).toBe(2);
    vi.advanceTimersByTime(READY_MS);
    expect(fallback).toEqual([true]);
  });

  it("is not a failure when a load is only replaced", () => {
    create();
    fire("did-fail-load", {}, -3, "ERR_ABORTED", "tavora://app/toasts.html", true);
    expect(errors).not.toHaveBeenCalled();
    expect(page().loads).toBe(1);
  });

  it("holds the toasts' time while Tavora is hidden or behind the game", () => {
    const view = create();
    view.sync(items({ id: 1, duration: 3000 }));
    fire("did-fail-load", {}, -6, "x", "u", true);
    vi.advanceTimersByTime(2000);
    view.setHidden(true);
    vi.advanceTimersByTime(5000);
    expect(events).toEqual([]);
    view.setHidden(false);
    vi.advanceTimersByTime(999);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual([{ type: "dismiss", id: 1 }]);
  });
});

describe("a toast page that crashes", () => {
  it("logs the error and expires the toasts mid-toast, then loads again", () => {
    const view = create();
    pageSays("toasts:ready");
    view.sync(items({ id: 1, duration: 3000, action: "Undo" }));
    vi.advanceTimersByTime(1000);
    fire("render-process-gone", {}, { reason: "crashed" });
    expect(errorText()).toContain("the toast page crashed (crashed)");
    expect(page().loads).toBe(2);
    // The page took its clock with it, so the toast gets its whole time again from the crash.
    vi.advanceTimersByTime(2999);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual([{ type: "dismiss", id: 1 }]);
  });

  it("does not count a clean exit", () => {
    create();
    fire("render-process-gone", {}, { reason: "clean-exit" });
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("a toast page that comes back", () => {
  it("shows the toasts above the panels again and stops expiring them itself", () => {
    const view = create();
    view.sync(items({ id: 1, duration: 3000 }, { id: 2, duration: 4000 }));
    fire("render-process-gone", {}, { reason: "crashed" });
    pageSays("toasts:ready");
    expect(errorText()).toContain("the toast page is back");
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual([]);
    expect(fallback).toEqual([]);
  });

  it("takes the toasts back from the host page when it was already handed them", () => {
    create();
    fire("did-fail-load", {}, -6, "x", "u", true);
    fire("did-fail-load", {}, -6, "x", "u", true);
    expect(fallback).toEqual([true]);
    // A later load works (the page is loaded again by hand or by a new window state).
    pageSays("toasts:ready");
    expect(fallback).toEqual([true, false]);
  });
});
