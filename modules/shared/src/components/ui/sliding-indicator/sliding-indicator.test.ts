import { afterEach, describe, expect, it } from "vitest";
import { inputOrigin, resetInputOrigin, trackInputOrigin, type OriginTarget } from "./input-origin";
import { createSlidingIndicator, type IndicatorEnv } from "./sliding-indicator";

// Tests run in Node, so the container, its items and the browser's observers are stand-ins.

interface FakeItem {
  offsetLeft: number;
  offsetTop: number;
  offsetWidth: number;
  offsetHeight: number;
}

class FakeContainer {
  attrs: Record<string, string> = {};
  vars: Record<string, string> = {};
  items: FakeItem[] = [];
  active: FakeItem | null = null;
  selectors: string[] = [];
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

/** A row of items laid out left to right with a gap of 2. */
function row(widths: number[]) {
  let left = 2;
  return widths.map((offsetWidth) => {
    const item = { offsetLeft: left, offsetTop: 2, offsetWidth, offsetHeight: 28 };
    left += offsetWidth + 2;
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

  it("slides when the active item changes", () => {
    const t = setup();
    t.container.active = t.container.items[2]!;
    t.changed();
    expect(t.container.attrs["data-indicator"]).toBe("slide");
    expect(t.container.vars["--indicator-x"]).toBe("106px");
    expect(t.container.vars["--indicator-w"]).toBe("50px");
  });

  it("jumps when smooth says no (a change made with the keys)", () => {
    let smooth = false;
    const t = setup([40, 60, 50], () => smooth);
    t.container.active = t.container.items[1]!;
    t.changed();
    expect(t.container.attrs["data-indicator"]).toBe("still");
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
      item.offsetWidth += 10;
      item.offsetLeft = 2 + index * 72;
    });
    t.fontsLoaded();
    await Promise.resolve();
    expect(t.container.vars["--indicator-x"]).toBe("74px");
    expect(t.container.vars["--indicator-w"]).toBe("70px");
    expect(t.container.attrs["data-indicator"]).toBe("still");
  });

  it("is placed right again after fonts load later (loadingdone)", () => {
    const t = setup();
    t.container.items[0]!.offsetWidth = 55;
    [...t.listeners].forEach((listener) => listener());
    expect(t.container.vars["--indicator-w"]).toBe("55px");
  });

  it("is placed right again after a window resize, without sliding", () => {
    const t = setup();
    t.container.items.forEach((item) => {
      item.offsetWidth *= 2;
    });
    t.container.items[1]!.offsetLeft = 100;
    t.container.active = t.container.items[1]!;
    t.resize();
    expect(t.container.vars["--indicator-x"]).toBe("100px");
    expect(t.container.vars["--indicator-w"]).toBe("120px");
    expect(t.container.attrs["data-indicator"]).toBe("still");
  });

  it("is placed right again when the options change, without sliding", () => {
    const t = setup();
    const item = t.container.items[0]!;
    // A new option in front pushes the active one along: same item, new place.
    item.offsetLeft = 80;
    t.container.items.unshift({ offsetLeft: 2, offsetTop: 2, offsetWidth: 74, offsetHeight: 28 });
    t.changed();
    expect(t.container.vars["--indicator-x"]).toBe("80px");
    expect(t.container.attrs["data-indicator"]).toBe("still");
    expect(t.watching.size).toBe(1 + 4);
  });

  it("hides while nothing is active (mixed, disabled) and comes back in place, not sliding in", () => {
    const t = setup();
    t.container.active = null;
    t.changed();
    expect(t.container.attrs["data-indicator"]).toBe("off");
    t.container.active = t.container.items[2]!;
    t.changed();
    expect(t.container.attrs["data-indicator"]).toBe("still");
    expect(t.container.vars["--indicator-x"]).toBe("106px");
  });

  it("hides while the container is not shown (0 x 0) and is placed once it shows", () => {
    const t = setup();
    const item = t.container.items[0]!;
    Object.assign(item, { offsetLeft: 0, offsetTop: 0, offsetWidth: 0, offsetHeight: 0 });
    t.resize();
    expect(t.container.attrs["data-indicator"]).toBe("off");
    Object.assign(item, { offsetLeft: 2, offsetTop: 2, offsetWidth: 40, offsetHeight: 28 });
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
    container.items = [{ offsetLeft: 0, offsetTop: 0, offsetWidth: 80, offsetHeight: 24 }];
    container.active = container.items[0]!;
    createSlidingIndicator(container, { selector: ".active", axis: "y", env: {} });
    expect(container.attrs["data-indicator-axis"]).toBe("y");
    expect(container.vars["--indicator-h"]).toBe("24px");
  });
});

describe("input origin", () => {
  class FakeDocument implements OriginTarget {
    listeners = new Map<string, Set<() => void>>();
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
    }
    removeEventListener(type: string, listener: () => void) {
      this.listeners.get(type)?.delete(listener);
    }
    fire(type: string) {
      this.listeners.get(type)?.forEach((listener) => listener());
    }
    count() {
      return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
    }
  }

  afterEach(resetInputOrigin);

  it("follows pointerdown and keydown, and starts as pointer", () => {
    const doc = new FakeDocument();
    const stop = trackInputOrigin(doc);
    expect(inputOrigin()).toBe("pointer");
    doc.fire("keydown");
    expect(inputOrigin()).toBe("key");
    doc.fire("pointerdown");
    expect(inputOrigin()).toBe("pointer");
    stop();
  });

  it("shares one pair of listeners and removes them with the last user", () => {
    const doc = new FakeDocument();
    const a = trackInputOrigin(doc);
    const b = trackInputOrigin(doc);
    expect(doc.count()).toBe(2);
    a();
    a();
    expect(doc.count()).toBe(2);
    b();
    expect(doc.count()).toBe(0);
  });
});
