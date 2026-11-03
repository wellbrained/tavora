// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountOverlayText, SCALE_VAR, type OverlayText, type OverlayTextOptions } from "./overlay-text";

// jsdom lays nothing out and has no Web Animations: the box and the text get their sizes here, and the animation is a fake.
class FakeAnimation {
  static made: FakeAnimation[] = [];
  currentTime: number | null = 0;
  playState: "running" | "paused" | "idle" = "running";
  constructor(
    readonly frames: Keyframe[],
    readonly options: KeyframeAnimationOptions,
  ) {
    FakeAnimation.made.push(this);
  }
  cancel() {
    this.playState = "idle";
  }
  pause() {
    this.playState = "paused";
  }
  play() {
    this.playState = "running";
  }
}

let reduced = false;
const motionListeners = new Set<() => void>();
let root: HTMLElement;
let text: OverlayText;
let room = { width: 300, height: 50 };
/** The text's size at its natural size. */
let natural = { width: 100, height: 50 };

function mount(options: Partial<OverlayTextOptions>) {
  root = document.createElement("div");
  document.body.append(root);
  Object.defineProperty(root, "clientWidth", { get: () => room.width });
  Object.defineProperty(root, "clientHeight", { get: () => room.height });
  text = mountOverlayText(root, options);
  text.content.getBoundingClientRect = () => ({ width: natural.width, height: natural.height }) as DOMRect;
  text.fit();
}

const running = () => FakeAnimation.made.filter((one) => one.playState !== "idle");
const scale = () => Number(root.style.getPropertyValue(SCALE_VAR));

beforeEach(() => {
  FakeAnimation.made = [];
  reduced = false;
  room = { width: 300, height: 50 };
  natural = { width: 100, height: 50 };
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, fn: () => void) => motionListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => motionListeners.delete(fn),
  }));
  HTMLElement.prototype.animate = function (frames: Keyframe[], options: KeyframeAnimationOptions) {
    return new FakeAnimation(frames, options) as unknown as Animation;
  } as unknown as HTMLElement["animate"];
});

afterEach(() => {
  text?.destroy();
  root?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  motionListeners.clear();
});

describe("grows with the text", () => {
  it("is drawn at the box's scale, never cut or scrolled", () => {
    room = { width: 200, height: 100 };
    mount({ mode: "grow" });
    expect(scale()).toBe(2);
    expect(root.dataset.plan).toBe("fit");
    expect(running()).toHaveLength(0);
  });

  it("keeps its size when the text gets wider before the frame does, with no timer to run out", () => {
    vi.useFakeTimers();
    room = { width: 216, height: 116 };
    mount({ mode: "grow", padding: 8 });
    expect(scale()).toBe(2);
    natural = { width: 120, height: 50 };
    text.changed();
    expect(scale()).toBe(2);
    // However late the frame comes, it stays: nothing shrinks it in between.
    vi.advanceTimersByTime(5000);
    expect(scale()).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
    // The frame follows: still 2.
    room = { width: 256, height: 116 };
    text.fit();
    expect(scale()).toBe(2);
  });

  it("follows the frame at once when it is resized", () => {
    mount({ mode: "grow" });
    expect(scale()).toBe(1);
    room = { width: 150, height: 25 };
    text.fit();
    expect(scale()).toBe(0.5);
  });
});

describe("a fixed box", () => {
  it("keeps a short text at its size and alignment", () => {
    room = { width: 500, height: 50 };
    natural = { width: 10, height: 50 };
    mount({ mode: "fixed", align: "left" });
    expect(scale()).toBe(1);
    expect(root.dataset.align).toBe("left");
    expect(root.dataset.plan).toBe("fit");
    expect(running()).toHaveLength(0);
  });

  it("scrolls a text too long in a loop, with the pause at the start of each round and a copy behind it", () => {
    natural = { width: 600, height: 50 };
    mount({ mode: "fixed", overflow: "scroll", speed: "normal", pause: 2, gap: 40 });
    expect(root.dataset.plan).toBe("scroll");
    const [animation] = running();
    expect(animation!.options.iterations).toBe(Infinity);
    expect(animation!.frames.map((frame) => frame.transform)).toEqual(["translateX(0)", "translateX(0)", "translateX(-640px)"]);
    expect(animation!.frames[1]!.offset).toBeCloseTo(2000 / (2000 + 8000));
    const copy = root.querySelector(".tavora-overlay-text-copy");
    expect(copy?.getAttribute("aria-hidden")).toBe("true");
    // Only transform moves, so the compositor runs it.
    expect(animation!.frames.every((frame) => Object.keys(frame).every((key) => key === "transform" || key === "offset"))).toBe(true);
  });

  it("has no pause frame with the pause off", () => {
    natural = { width: 600, height: 50 };
    mount({ mode: "fixed", pause: 0 });
    expect(running()[0]!.frames).toHaveLength(2);
  });

  it("softens the edges only while it scrolls, when they are on", () => {
    natural = { width: 600, height: 50 };
    mount({ mode: "fixed", softEdges: true });
    expect(root.dataset.fade).toBe("true");
    text.set({ softEdges: false });
    expect(root.dataset.fade).toBe("false");
    text.set({ softEdges: true });
    natural = { width: 100, height: 50 };
    text.changed();
    expect(root.dataset.fade).toBe("false");
  });

  it("goes on where it is when the text ticks, and starts the round again for a new text", () => {
    natural = { width: 600, height: 50 };
    mount({ mode: "fixed", pause: 0, gap: 0 });
    const first = running()[0]!;
    first.currentTime = 3000;
    // A counter ticks: one digit more.
    natural = { width: 620, height: 50 };
    text.changed();
    const second = running()[0]!;
    expect(second).not.toBe(first);
    expect(second.currentTime).toBeCloseTo((3000 / 7500) * 7750);
    // The same width again: the round runs on untouched.
    text.changed();
    expect(running()[0]).toBe(second);
    // The next song.
    second.currentTime = 2000;
    text.changed(true);
    expect(running()[0]!.currentTime).toBe(0);
  });

  it("starts and stops scrolling cleanly as the text gets too long and fits again", () => {
    mount({ mode: "fixed" });
    expect(running()).toHaveLength(0);
    natural = { width: 600, height: 50 };
    text.changed();
    expect(running()).toHaveLength(1);
    expect(root.querySelectorAll(".tavora-overlay-text-copy")).toHaveLength(1);
    natural = { width: 200, height: 50 };
    text.changed();
    expect(running()).toHaveLength(0);
    expect(root.querySelector(".tavora-overlay-text-copy")).toBeNull();
    natural = { width: 600, height: 50 };
    text.changed();
    expect(running()).toHaveLength(1);
    expect(running()[0]!.currentTime).toBe(0);
  });

  it("keeps scrolling smoothly when the box is resized, and stops once it is wide enough", () => {
    natural = { width: 600, height: 50 };
    mount({ mode: "fixed" });
    const animation = running()[0]!;
    animation.currentTime = 1234;
    room = { width: 400, height: 50 };
    text.fit();
    // The round doesn't depend on the box's width: the same animation runs on.
    expect(running()[0]).toBe(animation);
    expect(animation.currentTime).toBe(1234);
    room = { width: 700, height: 50 };
    text.fit();
    expect(running()).toHaveLength(0);
  });

  it("gives the copy the new text without measuring or starting over, for a tick of the same size", () => {
    natural = { width: 600, height: 50 };
    mount({ mode: "fixed" });
    text.content.textContent = "12:00";
    text.fit();
    const animation = running()[0]!;
    animation.currentTime = 2000;
    let measured = 0;
    text.content.getBoundingClientRect = () => (measured++, { width: natural.width, height: natural.height }) as DOMRect;
    text.content.textContent = "12:01";
    text.mirror();
    expect(root.querySelector(".tavora-overlay-text-copy")!.textContent).toBe("12:01");
    expect(measured).toBe(0);
    expect(running()[0]).toBe(animation);
    expect(animation.currentTime).toBe(2000);
  });

  it("starts a new round when the speed or the pause changes", () => {
    natural = { width: 600, height: 50 };
    mount({ mode: "fixed" });
    running()[0]!.currentTime = 1000;
    text.set({ speed: "fast" });
    expect(running()[0]!.currentTime).toBe(0);
  });

  it("shrinks a text too long, and cuts one off", () => {
    natural = { width: 600, height: 50 };
    mount({ mode: "fixed", overflow: "shrink" });
    expect(scale()).toBe(0.5);
    expect(running()).toHaveLength(0);
    text.set({ overflow: "clip" });
    expect(scale()).toBe(1);
    expect(root.dataset.plan).toBe("clip");
  });

  it("cuts off instead of scrolling for reduced motion, also when that changes later", () => {
    natural = { width: 600, height: 50 };
    reduced = true;
    mount({ mode: "fixed", overflow: "scroll" });
    expect(root.dataset.plan).toBe("clip");
    expect(running()).toHaveLength(0);
    reduced = false;
    for (const fn of motionListeners) fn();
    expect(root.dataset.plan).toBe("scroll");
    reduced = true;
    for (const fn of motionListeners) fn();
    expect(running()).toHaveLength(0);
  });

  it("pauses the scroll while the page is hidden", () => {
    natural = { width: 600, height: 50 };
    mount({ mode: "fixed" });
    let state: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(running()[0]!.playState).toBe("paused");
    state = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(running()[0]!.playState).toBe("running");
    // Hidden by its page (nothing to show): paused too.
    root.hidden = true;
    text.fit();
    expect(running()[0]!.playState).toBe("paused");
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  it("stops everything when it goes", () => {
    natural = { width: 600, height: 50 };
    mount({ mode: "fixed" });
    text.destroy();
    expect(running()).toHaveLength(0);
  });
});
