// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newItem, overlayState, type Clock, type Counter, type OverlayLook } from "./items";
import { mountOverlayView } from "./overlay-view";

// jsdom lays nothing out and has no Web Animations: the box and the text get sizes here, and an animation is only recorded.
let box = { width: 400, height: 100 };
/** How wide the text is at its natural size, per character. */
const CHAR = 20;
const animations: { frames: Keyframe[]; currentTime: number | null; cancelled: boolean }[] = [];

beforeEach(() => {
  box = { width: 400, height: 100 };
  animations.length = 0;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  HTMLElement.prototype.animate = function (frames: Keyframe[]) {
    const made = { frames, currentTime: 0 as number | null, cancelled: false, cancel: () => (made.cancelled = true), pause() {}, play() {} };
    animations.push(made);
    return made as unknown as Animation;
  } as unknown as HTMLElement["animate"];
});
afterEach(() => vi.unstubAllGlobals());

const mount = (preview = false) => {
  const root = document.createElement("div");
  document.body.append(root);
  Object.defineProperty(root, "clientWidth", { get: () => box.width });
  Object.defineProperty(root, "clientHeight", { get: () => box.height });
  const view = mountOverlayView(root, { padding: 0, preview });
  const content = root.querySelector<HTMLElement>(".tavora-overlay-text-content")!;
  content.getBoundingClientRect = () => ({ width: (content.querySelector(".cc-line")?.textContent ?? "").length * CHAR, height: 50 }) as DOMRect;
  const runs = () => [...root.querySelectorAll(".tavora-overlay-text-content .cc-line > span")].map((run) => [run.className, run.textContent]);
  const scale = () => Number(root.style.getPropertyValue("--overlay-text-scale"));
  const running = () => animations.filter((one) => !one.cancelled);
  return { root, view, runs, scale, running };
};

const fixed = (look: OverlayLook, overflow: "scroll" | "shrink" | "clip" = "scroll"): OverlayLook => ({ ...look, textBox: { mode: "fixed", overflow, speed: "normal", pause: 2, softEdges: true } });

describe("the overlay view", () => {
  it("draws the words and the value as runs of their own, with the item's colours and font", () => {
    const { root, view, runs } = mount();
    const timer = newItem("countdown", "t", "Boss") as Clock;
    timer.look = { ...timer.look, text: "Round over in {time}", color: "#facc15", wordsColor: "#60a5fa", font: "mono", align: "left", outline: false, wordsStep: "l", numberStep: "xl" };
    view.draw(overlayState(timer), 0);
    expect(runs()).toEqual([["cc-w", "Round over in "], ["cc-n", "5:00"]]);
    expect(root.style.getPropertyValue("--color")).toBe("#facc15");
    expect(root.style.getPropertyValue("--words")).toBe("#60a5fa");
    expect(root.dataset).toMatchObject({ font: "mono", align: "left", outline: "false" });
    // The number is drawn bigger than the words (L and XL); the kit scales both alike.
    const [words, number] = [...root.querySelectorAll<HTMLElement>(".cc-line > span")].map((run) => parseFloat(run.style.getPropertyValue("--size")));
    expect(number).toBeGreaterThan(words!);
  });

  it("gives the words the number's colour until they have one of their own, and hides itself without a state", () => {
    const { root, view } = mount();
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    deaths.value = 7;
    view.draw(overlayState(deaths), 0);
    expect(root.style.getPropertyValue("--words")).toBe(deaths.look.color);
    expect(root.querySelector(".tavora-overlay-text-content")!.textContent).toBe("Deaths 7");
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
    expect(root.querySelector(".tavora-overlay-text-content")!.textContent).toBe("Boss Go!");
  });

  it("draws the state of a panel from before the sizes, the words' colour and the box at the default sizes, growing with its frame", () => {
    const { root, view, scale } = mount();
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    const state = JSON.parse(JSON.stringify(overlayState(deaths)));
    // What 0.1.16 published: no text, no sizes, no words colour, no box.
    delete state.text;
    for (const field of ["wordsStep", "numberStep", "wordsSize", "numberSize", "wordsColor", "textBox"]) delete state.look[field];
    view.draw(state, 0);
    const sizes = [...root.querySelectorAll<HTMLElement>(".cc-line > span")].map((run) => run.style.getPropertyValue("--size"));
    expect(sizes).toEqual(["48px", "48px"]);
    expect(root.dataset.mode).toBe("grow");
    // "Deaths 0" is 160 wide at its natural size; the 400 × 100 frame scales it by 2 (its height).
    expect(scale()).toBe(2);
  });
});

describe("grows with the text", () => {
  it("is as big as its frame makes it: the size step sets the frame, not the text in it", () => {
    const { view, scale } = mount();
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    box = { width: 160, height: 50 };
    view.draw(overlayState(deaths), 0);
    expect(scale()).toBe(1);
  });

  it("shows words and number at different steps on one line, scaled alike", () => {
    const { root, view, scale } = mount();
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    deaths.look = { ...deaths.look, wordsStep: "xs", numberStep: "xl" };
    view.draw(overlayState(deaths), 0);
    const [words, number] = [...root.querySelectorAll<HTMLElement>(".cc-line > span")].map((run) => parseFloat(run.style.getPropertyValue("--size")));
    expect(number! / words!).toBeCloseTo(20 / 12);
    expect(root.querySelector<HTMLElement>(".cc-line")!.style.getPropertyValue("--size")).toBe(`${number}px`);
    expect(scale()).toBe(2);
  });

  it("only shrinks to fit in the settings' preview, which is not its frame", () => {
    const { view, scale, root } = mount(true);
    view.draw(overlayState(newItem("counter", "d", "Deaths")), 0);
    expect(scale()).toBe(1);
    expect(root.dataset.mode).toBe("fixed");
  });
});

describe("a fixed box", () => {
  it("keeps a short text at its size and alignment: a dot in a big box stays a dot", () => {
    const { root, view, scale, running } = mount();
    const dot = newItem("counter", "d", "") as Counter;
    dot.look = { ...fixed(dot.look), text: ".", align: "left" };
    box = { width: 500, height: 50 };
    view.draw(overlayState(dot), 0);
    expect(scale()).toBe(1);
    expect(root.dataset).toMatchObject({ mode: "fixed", align: "left", plan: "fit" });
    expect(running()).toHaveLength(0);
  });

  it("scrolls a line too long, and a counter that ticks doesn't send it back to the start", () => {
    const { root, view, running } = mount();
    const deaths = newItem("counter", "d", "Deaths in the long dark cave") as Counter;
    deaths.look = fixed(deaths.look);
    view.draw(overlayState(deaths), 0);
    expect(root.dataset.plan).toBe("scroll");
    running()[0]!.currentTime = 4000;
    deaths.value = 10;
    view.draw(overlayState(deaths), 0);
    const now = running();
    expect(now).toHaveLength(1);
    expect(now[0]!.currentTime).toBeGreaterThan(3000);
  });

  it("starts the round again for new words", () => {
    const { view, running } = mount();
    const deaths = newItem("counter", "d", "Deaths in the long dark cave") as Counter;
    deaths.look = fixed(deaths.look);
    view.draw(overlayState(deaths), 0);
    running()[0]!.currentTime = 4000;
    deaths.look = { ...deaths.look, text: "Falls off the very long bridge: {count}" };
    view.draw(overlayState(deaths), 0);
    expect(running()[0]!.currentTime).toBe(0);
  });

  it("stops scrolling when the line fits again, and shrinks or cuts it off when asked", () => {
    const { root, view, running, scale } = mount();
    const deaths = newItem("counter", "d", "Deaths in the long dark cave") as Counter;
    deaths.look = fixed(deaths.look);
    view.draw(overlayState(deaths), 0);
    expect(running()).toHaveLength(1);
    deaths.look = { ...deaths.look, text: "{count}" };
    view.draw(overlayState(deaths), 0);
    expect(running()).toHaveLength(0);
    deaths.look = fixed({ ...deaths.look, text: "Deaths in the long dark cave {count}" }, "shrink");
    view.draw(overlayState(deaths), 0);
    expect(scale()).toBeLessThan(1);
    deaths.look = fixed(deaths.look, "clip");
    view.draw(overlayState(deaths), 0);
    expect(root.dataset.plan).toBe("clip");
    expect(scale()).toBe(1);
  });

  it("shows words and number at different steps on one line at their own sizes", () => {
    const { root, view, scale } = mount();
    const deaths = newItem("counter", "d", "D") as Counter;
    deaths.look = { ...fixed(deaths.look), wordsStep: "s", numberStep: "l" };
    view.draw(overlayState(deaths), 0);
    expect(scale()).toBe(1);
    const sizes = [...root.querySelectorAll<HTMLElement>(".cc-line > span")].map((run) => parseFloat(run.style.getPropertyValue("--size")));
    expect(sizes[1]! / sizes[0]!).toBeCloseTo(16 / 13);
  });
});

describe("drawing again", () => {
  /** Counts how often the view measures its text (each fit measures once). */
  const counted = (preview = false) => {
    const made = mount(preview);
    const content = made.root.querySelector<HTMLElement>(".tavora-overlay-text-content")!;
    const measure = content.getBoundingClientRect;
    let measured = 0;
    content.getBoundingClientRect = () => (measured++, measure());
    return { ...made, measured: () => measured };
  };

  it("measures nothing for the same text again: a clock draws four times a second", () => {
    const { view, measured } = counted();
    const run = newItem("stopwatch", "r", "Run") as Clock;
    run.since = 0;
    view.draw(overlayState(run), 1000);
    const first = measured();
    for (const at of [1100, 1350, 1600, 1850]) view.draw(overlayState(run), at);
    expect(measured()).toBe(first);
  });

  it("only takes the new digits of a tick of the same size, and the scrolling copy shows them", () => {
    const { root, view, measured, running } = counted();
    const run = newItem("stopwatch", "r", "Run through the very long dark cave") as Clock;
    run.since = 0;
    run.look = fixed(run.look);
    view.draw(overlayState(run), 1000);
    expect(root.dataset.plan).toBe("scroll");
    const animation = running()[0]!;
    animation.currentTime = 3000;
    const first = measured();
    view.draw(overlayState(run), 2000);
    expect(measured()).toBe(first);
    expect(running()[0]).toBe(animation);
    expect(animation.currentTime).toBe(3000);
    expect(root.querySelector(".tavora-overlay-text-copy .cc-n")!.textContent).toBe("0:02");
  });

  it("measures again when the text changes size (9:59 to 10:00) or its settings change", () => {
    const { view, measured } = counted();
    const run = newItem("stopwatch", "r", "Run") as Clock;
    run.since = 0;
    view.draw(overlayState(run), 599_000);
    const first = measured();
    view.draw(overlayState(run), 600_000);
    expect(measured()).toBe(first + 1);
    run.look = { ...run.look, numberStep: "xl" };
    view.draw(overlayState(run), 600_000);
    expect(measured()).toBe(first + 2);
  });

  it("draws everything again after it was hidden", () => {
    const { root, view, measured } = counted();
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    view.draw(overlayState(deaths), 0);
    view.draw(null);
    const before = measured();
    view.draw(overlayState(deaths), 0);
    expect(root.hidden).toBe(false);
    expect(measured()).toBeGreaterThan(before);
  });
});
