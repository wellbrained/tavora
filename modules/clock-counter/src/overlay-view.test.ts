// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { newItem, overlayState, type Clock, type Counter } from "./items";
import { mountOverlayView } from "./overlay-view";

const mount = () => {
  const root = document.createElement("div");
  document.body.append(root);
  const view = mountOverlayView(root, { box: () => ({ width: 400, height: 100 }), padding: 0, grow: false });
  const runs = () => [...root.querySelectorAll(".cc-line > span")].map((run) => [run.className, run.textContent]);
  return { root, view, runs };
};

describe("the overlay view", () => {
  it("draws the words and the value as runs of their own, with the item's colours and font", () => {
    const { root, view, runs } = mount();
    const timer = newItem("countdown", "t", "Boss") as Clock;
    timer.look = { ...timer.look, text: "Round over in {time}", color: "#facc15", wordsColor: "#60a5fa", font: "mono", align: "left", outline: false, scale: 2, wordsSize: "l", numberSize: "xl" };
    view.draw(overlayState(timer), 0);
    expect(runs()).toEqual([["cc-w", "Round over in "], ["cc-n", "5:00"]]);
    expect(root.style.getPropertyValue("--color")).toBe("#facc15");
    expect(root.style.getPropertyValue("--words")).toBe("#60a5fa");
    expect(root.dataset).toMatchObject({ font: "mono", align: "left", outline: "false" });
    // The number is drawn bigger than the words (L and XL); the layout itself is measured in a browser.
    const [words, number] = [...root.querySelectorAll<HTMLElement>(".cc-line > span")];
    expect(parseFloat(number!.style.fontSize)).toBeGreaterThan(parseFloat(words!.style.fontSize));
  });

  it("gives the words the number's colour until they have one of their own, and hides itself without a state", () => {
    const { root, view } = mount();
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    deaths.value = 7;
    view.draw(overlayState(deaths), 0);
    expect(root.style.getPropertyValue("--words")).toBe(deaths.look.color);
    expect(root.textContent).toBe("Deaths 7");
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
    expect(root.textContent).toBe("Boss Go!");
  });

  it("draws the state of a panel from before the sizes and the words' colour at the default sizes, not NaN", () => {
    const { root, view } = mount();
    const deaths = newItem("counter", "d", "Deaths") as Counter;
    const state = JSON.parse(JSON.stringify(overlayState(deaths)));
    // What 0.1.16 published: no text, no sizes, no words colour.
    delete state.text;
    delete state.look.scale;
    delete state.look.wordsSize;
    delete state.look.numberSize;
    delete state.look.wordsColor;
    view.draw(state, 0);
    const sizes = [...root.querySelectorAll<HTMLElement>(".cc-line > span")].map((run) => run.style.fontSize);
    const [words, number] = sizes.map(parseFloat);
    expect(words).toBeCloseTo((48 * 12) / 14, 6);
    expect(number).toBe(48);
    expect(root.querySelector<HTMLElement>(".cc-line")!.style.fontSize).toBe("48px");
    expect(root.textContent).toBe("Deaths 0");
  });
});
