import { afterEach, describe, expect, it } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { inputOrigin, POINTER_WINDOW_MS, resetInputOrigin, trackInputOrigin, type OriginTarget } from "./input-origin";
import { useSlidingIndicator } from "./use-sliding-indicator";
import { createSlidingIndicator, type IndicatorEnv } from "./sliding-indicator";

// Tests run in Node, so the container, its items and the browser's observers are stand-ins.

/** An item with a place in the viewport, as getBoundingClientRect reports it (fractions and all). */
class FakeItem {
  classList = { contains: (name: string) => this.className === name };
  constructor(
    public left: number,
    public top: number,
    public width: number,
    public height: number,
    public className = "",
  ) {}
  getBoundingClientRect() {
    return { left: this.left, top: this.top, width: this.width, height: this.height };
  }
}

class FakeContainer {
  // The container sits at (100, 50) in the viewport, with a 1px border and no scrolling.
  left = 100;
  top = 50;
  clientLeft = 1;
  clientTop = 1;
  scrollLeft = 0;
  scrollTop = 0;
  getBoundingClientRect() {
    return { left: this.left, top: this.top, width: 300, height: 32 };
  }
  attrs: Record<string, string> = {};
  vars: Record<string, string> = {};
  items: FakeItem[] = [];
  active: FakeItem | null = null;
  selectors: string[] = [];
  /** Move the whole container, as scrolling the page or dragging the window does. */
  moveTo(left: number, top: number) {
    this.left = left;
    this.top = top;
  }
  style = { setProperty: (name: string, value: string) => void (this.vars[name] = value) };
  get children() {
    return this.items;
  }
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  querySelector(selector: string) {
    this.selectors.push(selector);
    return this.active;
  }
}

/** A row of items laid out left to right with a gap of 2, inside the container's border and 2px padding. */
function row(widths: number[]) {
  let left = 100 + 1 + 2;
  return widths.map((width) => {
    const item = new FakeItem(left, 50 + 1 + 2, width, 28);
    left += width + 2;
    return item;
  });
}

function setup(widths = [40, 60, 50], smooth: () => boolean = () => true) {
  const container = new FakeContainer();
  container.items = row(widths);
  container.active = container.items[0]!;

  const resizes: Array<() => void> = [];
  const mutations: Array<() => void> = [];
  const watching = new Set<unknown>();
  let fontsLoaded!: () => void;
  const listeners = new Set<() => void>();
  const env: IndicatorEnv = {
    ResizeObserver: class {
      constructor(callback: () => void) {
        resizes.push(callback);
      }
      observe = (target: unknown) => void watching.add(target);
      unobserve = (target: unknown) => void watching.delete(target);
      disconnect = () => watching.clear();
    },
    MutationObserver: class {
      constructor(callback: () => void) {
        mutations.push(callback);
      }
      observe() {}
      disconnect() {}
    },
    fonts: {
      ready: new Promise<void>((resolve) => (fontsLoaded = resolve)),
      addEventListener: (_type, listener) => void listeners.add(listener),
      removeEventListener: (_type, listener) => void listeners.delete(listener),
    },
  };
  const indicator = createSlidingIndicator(container, { selector: ".active", smooth, env });
  return {
    container,
    indicator,
    watching,
    listeners,
    resize: () => resizes.forEach((callback) => callback()),
    changed: () => mutations.forEach((callback) => callback()),
    fontsLoaded,
  };
}

describe("sliding indicator", () => {
  it("places the highlight on the active item at first paint, without sliding", () => {
    const { container } = setup();
    expect(container.vars).toEqual({ "--indicator-x": "2px", "--indicator-y": "2px", "--indicator-w": "40px", "--indicator-h": "28px" });
    expect(container.attrs).toMatchObject({ "data-indicator": "still", "data-indicator-axis": "x" });
  });

  it("measures fractions, relative to the container's padding box (not whole pixels, not the viewport)", () => {
    const t = setup();
    // Inter is not whole pixels wide, and a tab sits at half a pixel (items-center with a -1px margin).
    Object.assign(t.container.items[0]!, { left: 103.25, top: 53.5, width: 41.4140625, height: 31 });
    t.resize();
    expect(t.container.vars).toEqual({ "--indicator-x": "2.25px", "--indicator-y": "2.5px", "--indicator-w": "41.41px", "--indicator-h": "31px" });
    // The page scrolls: the container and its items move together, so the place inside it stays.
    t.container.items.forEach((item) => (item.left += 7));
    t.container.moveTo(107, 50);
    t.resize();
    expect(t.container.vars["--indicator-x"]).toBe("2.25px");
    // A container that scrolls inside (tabs with overflow): its items move left, the highlight scrolls along.
    t.container.scrollLeft = 30;
    t.container.items.forEach((item) => (item.left -= 30));
    t.resize();
    expect(t.container.vars["--indicator-x"]).toBe("2.25px");
  });

  it("measures as laid out while the container is drawn scaled (a dialog zooming in), so it fits once that ends", () => {
    const t = setup();
    // Drawn at half size: on screen the container is 300 wide but lays out at 600, and its items shrink with it.
    Object.assign(t.container, { offsetWidth: 600, offsetHeight: 64 });
    Object.assign(t.container.items[0]!, { left: 101.5, top: 51.5, width: 20, height: 14 });
    t.resize();
    expect(t.container.vars).toEqual({ "--indicator-x": "2px", "--indicator-y": "2px", "--indicator-w": "40px", "--indicator-h": "28px" });
  });

  it("slides when the active item changes", () => {
    const t = setup();
    t.container.active = t.container.items[2]!;
    t.changed();
    expect(t.container.attrs["data-indicator"]).toBe("slide");
    expect(t.container.vars["--indicator-x"]).toBe("106px");
    expect(t.container.vars["--indicator-w"]).toBe("50px");
  });

  it("jumps when smooth says no (a change made with the keys), and says so for the labels", () => {
    let smooth = false;
    const t = setup([40, 60, 50], () => smooth);
    t.container.active = t.container.items[1]!;
    t.changed();
    expect(t.container.attrs["data-indicator"]).toBe("jump");
    expect(t.container.vars["--indicator-x"]).toBe("44px");
    smooth = true;
    t.container.active = t.container.items[2]!;
    t.changed();
    expect(t.container.attrs["data-indicator"]).toBe("slide");
  });

  it("is placed right again after a font loads (items change width), without sliding", async () => {
    const t = setup();
    t.container.active = t.container.items[1]!;
    t.changed();
    // The real font is wider: every item grows.
    t.container.items.forEach((item, index) => {
      item.width += 10;
      item.left = 103 + index * 72;
    });
    t.fontsLoaded();
    await Promise.resolve();
    expect(t.container.vars["--indicator-x"]).toBe("74px");
    expect(t.container.vars["--indicator-w"]).toBe("70px");
    expect(t.container.attrs["data-indicator"]).toBe("still");
  });

  it("is placed right again after fonts load later (loadingdone)", () => {
    const t = setup();
    t.container.items[0]!.width = 55;
    [...t.listeners].forEach((listener) => listener());
    expect(t.container.vars["--indicator-w"]).toBe("55px");
  });

  it("is placed right again after a window resize, without sliding", () => {
    const t = setup();
    t.container.items.forEach((item) => {
      item.width *= 2;
    });
    t.container.items[1]!.left = 200;
    t.container.active = t.container.items[1]!;
    t.resize();
    expect(t.container.vars["--indicator-x"]).toBe("99px");
    expect(t.container.vars["--indicator-w"]).toBe("120px");
    expect(t.container.attrs["data-indicator"]).toBe("still");
  });

  it("is placed right again when the options change, without sliding", () => {
    const t = setup();
    const item = t.container.items[0]!;
    // A new option in front pushes the active one along: same item, new place.
    item.left = 100 + 1 + 80;
    t.container.items.unshift(new FakeItem(103, 53, 74, 28));
    t.changed();
    expect(t.container.vars["--indicator-x"]).toBe("80px");
    expect(t.container.attrs["data-indicator"]).toBe("still");
    expect(t.watching.size).toBe(1 + 4);
  });

  it("does not watch the highlight itself (it changes size every frame of a slide)", () => {
    const t = setup();
    const pill = new FakeItem(0, 0, 10, 10, "tavora-indicator");
    t.container.items.unshift(pill);
    t.changed();
    expect(t.watching.has(pill)).toBe(false);
    expect(t.watching.size).toBe(1 + 3);
  });

  it("hides while nothing is active (mixed, disabled); a click then slides it back in from where it was, a key press jumps", () => {
    let smooth = true;
    const t = setup([40, 60, 50], () => smooth);
    t.container.active = null;
    t.changed();
    expect(t.container.attrs["data-indicator"]).toBe("off");
    // Hidden, but it keeps its place to slide from.
    expect(t.container.vars["--indicator-x"]).toBe("2px");
    t.container.active = t.container.items[2]!;
    t.changed();
    expect(t.container.attrs["data-indicator"]).toBe("slide");
    expect(t.container.vars["--indicator-x"]).toBe("106px");

    t.container.active = null;
    t.changed();
    smooth = false;
    t.container.active = t.container.items[1]!;
    t.changed();
    expect(t.container.attrs["data-indicator"]).toBe("jump");
  });

  it("the first click slides even when nothing was picked at mount (it rests on the first item until then)", () => {
    const container = new FakeContainer();
    container.items = row([40, 60, 50]);
    container.active = null;
    const mutations: Array<() => void> = [];
    const env: IndicatorEnv = {
      MutationObserver: class {
        constructor(callback: () => void) {
          mutations.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    };
    createSlidingIndicator(container, { selector: ".active", env });
    expect(container.attrs["data-indicator"]).toBe("off");
    expect(container.vars).toEqual({ "--indicator-x": "2px", "--indicator-y": "2px", "--indicator-w": "40px", "--indicator-h": "28px" });
    container.active = container.items[1]!;
    mutations.forEach((callback) => callback());
    expect(container.attrs["data-indicator"]).toBe("slide");
    expect(container.vars["--indicator-x"]).toBe("44px");
  });

  it("hides while the container is not shown (0 x 0) and is placed once it shows", () => {
    const t = setup();
    const item = t.container.items[0]!;
    Object.assign(item, { left: 0, top: 0, width: 0, height: 0 });
    t.resize();
    expect(t.container.attrs["data-indicator"]).toBe("off");
    Object.assign(item, { left: 103, top: 53, width: 40, height: 28 });
    t.resize();
    expect(t.container.attrs["data-indicator"]).toBe("still");
  });

  it("leaves a slide that is running alone when nothing moved", () => {
    const t = setup();
    t.container.active = t.container.items[1]!;
    t.changed();
    t.resize();
    t.changed();
    expect(t.container.attrs["data-indicator"]).toBe("slide");
  });

  it("stops measuring after destroy", () => {
    const t = setup();
    t.indicator.destroy();
    t.container.active = t.container.items[2]!;
    t.changed();
    expect(t.container.vars["--indicator-x"]).toBe("2px");
    expect(t.watching.size).toBe(0);
    expect(t.listeners.size).toBe(0);
  });

  it("works along the y axis too", () => {
    const container = new FakeContainer();
    container.items = [new FakeItem(101, 51, 80, 24)];
    container.active = container.items[0]!;
    createSlidingIndicator(container, { selector: ".active", axis: "y", env: {} });
    expect(container.attrs["data-indicator-axis"]).toBe("y");
    expect(container.vars["--indicator-h"]).toBe("24px");
  });
});

describe("useSlidingIndicator", () => {
  // No document here, so the composable follows no input and its default is "not just clicked": changes jump.
  function mount(enabled = ref(true)) {
    const container = new FakeContainer();
    container.items = row([40, 60, 50]);
    container.active = container.items[0]!;
    const el = ref<FakeContainer | null>(null);
    const scope = effectScope();
    const result = scope.run(() => useSlidingIndicator(el, { selector: ".active", enabled }))!;
    return { container, el, enabled, scope, result };
  }

  it("waits for its element, then places the highlight", async () => {
    const t = mount();
    expect(t.container.attrs["data-indicator"]).toBeUndefined();
    t.el.value = t.container;
    await nextTick();
    expect(t.container.attrs["data-indicator"]).toBe("still");
    expect(t.container.vars["--indicator-w"]).toBe("40px");
    t.scope.stop();
  });

  it("is switched off and on by `enabled`", async () => {
    const t = mount();
    t.el.value = t.container;
    await nextTick();
    t.enabled.value = false;
    await nextTick();
    // Off: the hook measures no more.
    t.container.active = t.container.items[2]!;
    t.result.update();
    expect(t.container.vars["--indicator-w"]).toBe("40px");
    t.enabled.value = true;
    await nextTick();
    expect(t.container.vars["--indicator-w"]).toBe("50px");
    t.scope.stop();
  });

  it("lets go when its scope ends", async () => {
    const t = mount();
    t.el.value = t.container;
    await nextTick();
    t.scope.stop();
    t.container.active = t.container.items[1]!;
    t.result.update();
    expect(t.container.vars["--indicator-w"]).toBe("40px");
    // A new element after disposal gets no highlight.
    const other = new FakeContainer();
    other.items = row([30]);
    other.active = other.items[0]!;
    t.el.value = other;
    await nextTick();
    expect(other.attrs["data-indicator"]).toBeUndefined();
  });
});

describe("the first click", () => {
  // The whole path, as in the app: the control mounts, the document is followed from then on, the first pointer press
  // is seen, and the change that follows it slides. First paint and a key press still don't.
  class Doc {
    listeners = new Map<string, Array<(event: object) => void>>();
    addEventListener(type: string, listener: (event: object) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    removeEventListener() {}
    fire(type: string, event: object = {}) {
      this.listeners.get(type)?.forEach((listener) => listener(event));
    }
  }
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = { document: globals.document, MutationObserver: globals.MutationObserver, ResizeObserver: globals.ResizeObserver };
  afterEach(() => {
    Object.assign(globals, saved);
    resetInputOrigin();
  });

  function mount() {
    const doc = new Doc();
    const mutations: Array<() => void> = [];
    globals.document = doc;
    globals.ResizeObserver = undefined;
    globals.MutationObserver = class {
      constructor(callback: () => void) {
        mutations.push(callback);
      }
      observe() {}
      disconnect() {}
    };
    const container = new FakeContainer();
    container.items = row([40, 60, 50]);
    container.active = container.items[0]!;
    const el = ref<FakeContainer | null>(container);
    const scope = effectScope();
    scope.run(() => useSlidingIndicator(el, { selector: ".active" }));
    return { doc, container, change: (index: number) => { container.active = container.items[index]!; mutations.forEach((callback) => callback()); }, scope };
  }

  it("slides: the first pointer press after the control appears is seen", async () => {
    const t = mount();
    await nextTick();
    expect(t.container.attrs["data-indicator"]).toBe("still");
    t.doc.fire("pointerdown");
    t.change(1);
    expect(t.container.attrs["data-indicator"]).toBe("slide");
    t.scope.stop();
  });

  it("jumps for the first key press, and for a change nobody just made", async () => {
    const t = mount();
    await nextTick();
    t.doc.fire("keydown");
    t.change(1);
    expect(t.container.attrs["data-indicator"]).toBe("jump");
    t.scope.stop();
    const u = mount();
    await nextTick();
    u.change(2);
    expect(u.container.attrs["data-indicator"]).toBe("jump");
    u.scope.stop();
  });
});

describe("input origin", () => {
  class FakeDocument implements OriginTarget {
    listeners = new Map<string, Set<(event: never) => void>>();
    addEventListener(type: string, listener: (event: never) => void) {
      this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
    }
    removeEventListener(type: string, listener: (event: never) => void) {
      this.listeners.get(type)?.delete(listener);
    }
    fire(type: string, event: object = {}) {
      this.listeners.get(type)?.forEach((listener) => (listener as (event: object) => void)(event));
    }
    count() {
      return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
    }
  }

  let time = 1000;
  const now = () => time;
  afterEach(() => {
    resetInputOrigin();
    time = 1000;
  });

  it("is a pointer change only within half a second of a press", () => {
    const doc = new FakeDocument();
    const stop = trackInputOrigin(doc, now);
    // Nothing seen yet: a value that arrives on its own (settings loading) is not a click.
    expect(inputOrigin()).toBe("other");
    doc.fire("pointerdown");
    expect(inputOrigin()).toBe("pointer");
    time += POINTER_WINDOW_MS;
    expect(inputOrigin()).toBe("pointer");
    time += 1;
    expect(inputOrigin()).toBe("other");
    stop();
  });

  it("a mouse click marks the press again; a click made with the keyboard does not", () => {
    const doc = new FakeDocument();
    const stop = trackInputOrigin(doc, now);
    doc.fire("pointerdown");
    time += 800;
    doc.fire("click", { detail: 1 });
    expect(inputOrigin()).toBe("pointer");
    time += 800;
    doc.fire("click", { detail: 0 });
    expect(inputOrigin()).toBe("other");
    stop();
  });

  it("a key press after the press makes the change a key's", () => {
    const doc = new FakeDocument();
    const stop = trackInputOrigin(doc, now);
    doc.fire("pointerdown");
    time += 10;
    doc.fire("keydown");
    expect(inputOrigin()).toBe("key");
    time += 10;
    doc.fire("pointerdown");
    expect(inputOrigin()).toBe("pointer");
    stop();
  });

  it("shares one set of listeners, removes them with the last user, and forgets what it saw", () => {
    const doc = new FakeDocument();
    const a = trackInputOrigin(doc, now);
    const b = trackInputOrigin(doc, now);
    expect(doc.count()).toBe(3);
    doc.fire("pointerdown");
    a();
    a();
    expect(doc.count()).toBe(3);
    expect(inputOrigin()).toBe("pointer");
    b();
    expect(doc.count()).toBe(0);
    expect(inputOrigin()).toBe("other");
  });
});
