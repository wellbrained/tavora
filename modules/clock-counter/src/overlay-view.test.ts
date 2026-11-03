// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newItem, overlayState, sizesOf, type Clock, type Counter } from "./items";
import { mountOverlayView } from "./overlay-view";
import type { OverlayViewOptions } from "./overlay-view";

/** jsdom lays nothing out: the box and the text get the sizes a test gives them (the text's at 100 %, 48 px for M). */
const layout = { box: { width: 400, height: 100 }, text: { width: 200, height: 50 } };
const animations: { frames: Keyframe[]; currentTime: number | null; cancelled: boolean }[] = [];

beforeEach(() => {
  layout.box = { width: 400, height: 100 };
  layout.text = { width: 200, height: 50 };
  animations.length = 0;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("tv-otext") ? layout.box.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("tv-otext") ? layout.box.height : 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const size = this.classList.contains("tv-otext__content") ? layout.text : { width: 0, height: 0 };
    return { ...size, x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: size.height, toJSON: () => ({}) } as DOMRect;
  });
  HTMLElement.prototype.animate = function (frames: Keyframe[]) {
    const animation = { frames, currentTime: 0 as number | null, cancelled: false, play() {}, pause() {}, cancel() { this.cancelled = true; } };
    animations.push(animation);
    return animation as unknown as Animation;
  } as HTMLElement["animate"];
});

afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error jsdom has no animate of its own
  delete HTMLElement.prototype.animate;
  document.body.replaceChildren();
});

const mount = (options: Partial<OverlayViewOptions> = {}) => {
  const root = document.createElement("div");
  document.body.append(root);
  const view = mountOverlayView(root, { padding: 0, scaleBy: "down", ...options });
  const runs = () => [...root.querySelectorAll(".tv-otext__content .cc-line > span")].map((run) => [run.className, run.textContent]);
  const fontPx = () => parseFloat(root.querySelector<HTMLElement>(".tv-otext__track")!.style.fontSize);
  const live = () => animations.filter((one) => !one.cancelled);
  return { root, view, runs, fontPx, live };
};

describe("the overlay view", () => {
  it("draws the words and the value as runs of their own, with the item's colours and font", () => {
    const { root, view, runs } = mount();
    const timer = newItem("countdown", "t", "Boss") as Clock;
    timer.look = { ...timer.look, text: "Round over in {time}", color: "#facc15", wordsColor: "#60a5fa", font: "mono", align: "left", outline: false, ...sizesOf("l", "xl") };
    view.draw(overlayState(timer), 0);
    expect(runs()).toEqual([["cc-w", "Round over in "], ["cc-n", "5:00"]]);
    expect(root.style.getPropertyValue("--color")).toBe("#facc15");
    expect(root.style.getPropertyValue("--words")).toBe("#60a5fa");
    expect(root.dataset).toMatchObject({ font: "mono", align: "left", outline: "false" });
    // The number is drawn bigger than the words (L and XL), each as a share of the line, which takes the biggest.
    const [words, number] = [...root.querySelectorAll<HTMLElement>(".tv-otext__content .cc-line > span")];
    expect(parseFloat(number!.style.fontSize)).toBeGreaterThan(parseFloat(words!.style.fontSize));
    expect(root.querySelector<HTMLElement>(".tv-otext__content .cc-line")!.style.fontSize).toBe(`${Number((20 / 14).toFixed(4))}em`);
    expect(number!.style.fontSize).toBe("1em");
  });

  it("gives the words the number's colour until they have one of their own, and hides itself without a state", () => {
    const { root, view } = mount();
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    deaths.value = 7;
    view.draw(overlayState(deaths), 0);
    expect(root.style.getPropertyValue("--words")).toBe(deaths.look.color);
    expect(root.querySelector(".tv-otext__content")!.textContent).toBe("Deaths 7");
    view.draw(null);
    expect(root.hidden).toBe(true);
  });

  it("flashes a finished countdown without a text of its own, and the text at 0 does not", () => {
    const { root, view } = mount();
    const timer = { ...(newItem("countdown", "t", "Boss") as Clock), duration: 1000, counted: 5000 };
    view.draw(overlayState(timer), 0);
    expect(root.dataset.done).toBe("flash");
    view.draw(overlayState({ ...timer, doneText: "Go!" }), 0);
    expect(root.dataset.done).toBeUndefined();
    expect(root.querySelector(".tv-otext__content")!.textContent).toBe("Boss Go!");
  });

  it("draws the state of a panel from before the sizes, the words' colour and the box at the default sizes, growing with the text", () => {
    const { root, view, fontPx } = mount({ scaleBy: "fill" });
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    const state = JSON.parse(JSON.stringify(overlayState(deaths)));
    // What 0.1.16 published: no text, no sizes, no words colour, no box.
    delete state.text;
    delete state.look.wordsStep;
    delete state.look.numberStep;
    delete state.look.wordsSize;
    delete state.look.numberSize;
    delete state.look.wordsColor;
    view.draw(state, 0);
    const sizes = [...root.querySelectorAll<HTMLElement>(".tv-otext__content .cc-line > span")].map((run) => run.style.fontSize);
    expect(sizes).toEqual(["1em", "1em"]);
    expect(root.dataset.box).toBe("grow");
    // 200 × 50 at 100 % fills the 400 × 100 window at twice its size, as it always did in OBS.
    expect(fontPx()).toBe(96);
    expect(root.querySelector(".tv-otext__content")!.textContent).toBe("Deaths 0");
  });
});

describe("the overlay view's box", () => {
  const counter = (patch: Partial<Counter["look"]> = {}) => {
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    deaths.look = { ...deaths.look, ...patch };
    return deaths;
  };

  it("grows with the text: in a Tavora frame the scale comes from the frame's height, so a longer text keeps its size", () => {
    const { view, fontPx } = mount({ scaleBy: "height" });
    layout.box = { width: 300, height: 100 };
    view.draw(overlayState(counter()), 0);
    expect(fontPx()).toBe(96);
    // 9 → 10: wider than the frame for a moment; drawn at the same size until the frame follows.
    layout.text = { width: 330, height: 50 };
    view.draw(overlayState({ ...counter(), value: 10 }), 0);
    expect(fontPx()).toBe(96);
  });

  it("keeps a short text at its step in a fixed box, never made bigger to fill it", () => {
    const { root, view, fontPx } = mount({ scaleBy: "fill" });
    layout.box = { width: 500, height: 50 };
    layout.text = { width: 12, height: 50 };
    view.draw(overlayState(counter({ box: "fixed", align: "left", text: "." })), 0);
    expect(root.dataset).toMatchObject({ box: "fixed", mode: "static", align: "left" });
    expect(fontPx()).toBe(48);
  });

  it("scrolls a long text in a fixed box, and a counter that ticks goes on where it is", () => {
    const { root, view, live } = mount({ scaleBy: "fill" });
    layout.box = { width: 300, height: 60 };
    layout.text = { width: 900, height: 50 };
    const long = counter({ box: "fixed", text: "Deaths in this very long run so far: {count}" });
    view.draw(overlayState(long), 0);
    expect(root.dataset.mode).toBe("scroll");
    expect(live()).toHaveLength(1);
    live()[0]!.currentTime = 6000;
    layout.text = { width: 920, height: 50 };
    view.draw(overlayState({ ...long, value: 100 }), 0);
    expect(live()).toHaveLength(1);
    expect(live()[0]!.currentTime).toBeGreaterThan(2000);
    // Other words: the round starts again.
    view.draw(overlayState({ ...long, look: { ...long.look, text: "Another long line of words: {count}" } }), 0);
    expect(live()[0]!.currentTime).toBe(0);
  });

  it("shrinks or cuts off a long text in a fixed box, as the look says", () => {
    const { root, view, fontPx } = mount({ scaleBy: "fill" });
    layout.box = { width: 450, height: 100 };
    layout.text = { width: 900, height: 50 };
    view.draw(overlayState(counter({ box: "fixed", tooLong: "shrink" })), 0);
    expect(fontPx()).toBe(24);
    view.draw(overlayState(counter({ box: "fixed", tooLong: "cut" })), 0);
    expect(root.dataset.mode).toBe("cut");
    expect(fontPx()).toBe(48);
  });

  it("hands the speed, the pause and the soft edges to the box", () => {
    const { root, view, live } = mount({ scaleBy: "fill" });
    layout.box = { width: 300, height: 60 };
    layout.text = { width: 900, height: 50 };
    view.draw(overlayState(counter({ box: "fixed", pause: 0, softEdges: false, speed: "fast" })), 0);
    expect(root.dataset.soft).toBe("false");
    expect(live()[0]!.frames).toHaveLength(2);
  });

  it("does nothing new when a clock is drawn again with the same text", () => {
    const { view, live } = mount({ scaleBy: "fill" });
    layout.box = { width: 300, height: 60 };
    layout.text = { width: 900, height: 50 };
    const timer = newItem("stopwatch", "s", "A very long stopwatch name") as Clock;
    timer.look = { ...timer.look, box: "fixed" };
    view.draw(overlayState(timer), 0);
    const first = live()[0];
    view.draw(overlayState(timer), 250);
    expect(live()[0]).toBe(first);
  });

  it("stops the scroll while hidden", () => {
    const { view, live } = mount({ scaleBy: "fill" });
    layout.box = { width: 300, height: 60 };
    layout.text = { width: 900, height: 50 };
    const pause = vi.fn();
    view.draw(overlayState(counter({ box: "fixed" })), 0);
    (live()[0] as unknown as { pause: () => void }).pause = pause;
    view.draw(null);
    expect(pause).toHaveBeenCalled();
  });
});
