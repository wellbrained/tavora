// Draws one item's overlay text into an element: the page OBS shows uses it with the whole window as its box, and the settings
// use it for their live preview, so what is previewed is what is drawn. The line is runs of words and values (template.ts); each
// has its own colour and size, the number keeps its tabular digits, and the whole line is scaled to fill the box.
import { sizeScales, type OverlayState } from "./items";
import { lineOf } from "./line";
import { LAP_SHARE, VALUE_PX } from "./sources";
import "./overlay-view.css";

export type OverlayView = {
  /** Draws what `state` shows at `now`, or hides the view for null. */
  draw(state: OverlayState | null, now?: number): void;
  /** Sizes the text again, once the box or the fonts changed. */
  fit(): void;
};

export type OverlayViewOptions = {
  /** The room the text may fill. */
  box: () => { width: number; height: number };
  /** The room kept around the text, in pixels of the box. */
  padding: number;
  /** The text grows to fill the box (a source in OBS), or only shrinks to fit it (a preview). */
  grow: boolean;
};

const element = (tag: string, className: string): HTMLElement => Object.assign(document.createElement(tag), { className });

export function mountOverlayView(root: HTMLElement, options: OverlayViewOptions): OverlayView {
  root.classList.add("cc-ov");
  root.style.padding = `${options.padding}px`;
  const line = element("div", "cc-line");
  const lap = element("div", "cc-lap");
  root.replaceChildren(line, lap);
  let sizes = { words: 1, number: 1 };

  /** Every size at `scale` times its natural one. */
  function size(scale: number): void {
    const px = (share: number) => `${VALUE_PX * share * scale}px`;
    const hasNumber = line.querySelector(".cc-n") !== null;
    const hasWords = line.querySelector(".cc-w") !== null;
    // The line box takes the biggest run, so the height is the same however the runs are mixed.
    line.style.fontSize = px(Math.max(hasNumber ? sizes.number : 0, hasWords ? sizes.words : 0));
    for (const run of line.children) (run as HTMLElement).style.fontSize = px(run.classList.contains("cc-n") ? sizes.number : sizes.words);
    lap.style.fontSize = px(sizes.number * LAP_SHARE);
  }

  function fit(): void {
    if (root.hidden) return;
    const box = options.box();
    const room = { width: Math.max(box.width - 2 * options.padding, 1), height: Math.max(box.height - 2 * options.padding, 1) };
    size(1);
    const lapShown = lap.textContent !== "";
    const natural = { width: Math.max(line.offsetWidth, lapShown ? lap.offsetWidth : 0), height: line.offsetHeight + (lapShown ? lap.offsetHeight : 0) };
    if (!natural.width || !natural.height) return;
    const scale = Math.min(room.width / natural.width, room.height / natural.height);
    size(options.grow ? scale : Math.min(scale, 1));
  }

  function draw(state: OverlayState | null, now = Date.now()): void {
    root.hidden = state === null;
    if (!state) return;
    const { look } = state;
    const shown = lineOf(state, now);
    root.style.setProperty("--color", look.color);
    root.style.setProperty("--words", look.wordsColor ?? look.color);
    root.dataset.font = look.font;
    root.dataset.align = look.align;
    root.dataset.outline = String(look.outline);
    if (shown.flashing) root.dataset.done = "flash";
    else delete root.dataset.done;
    sizes = sizeScales(look);
    line.replaceChildren(
      ...shown.segments.map((part) => {
        const run = element("span", part.value ? "cc-n" : "cc-w");
        run.textContent = part.text;
        return run;
      }),
    );
    lap.textContent = shown.lap;
    fit();
  }

  return { draw, fit };
}
