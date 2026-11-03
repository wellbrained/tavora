// Draws one item's overlay text into an element: the page OBS and Tavora's frames show uses it with the whole window as its box,
// and the settings use it for their live preview, so what is previewed is what is drawn. The line is runs of words and values
// (template.ts); each has its own colour and size, the number keeps its tabular digits. The box around it is the kit's
// OverlayText: a look that grows with the text is drawn at its step times the frame's scale, a fixed box keeps the text at its
// step and scrolls, shrinks or cuts off what is too long.
import { mountOverlayText, type OverlayTextScaleBy } from "@tavora/official-ui/components/ui/overlay-text";
import { boxOf, sizeScales, type OverlayState } from "./items";
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
  /** The room kept around the text, in pixels of the box. */
  padding: number;
  /**
   * How a text that grows with its box finds its scale: `fill` fits it into the window (OBS, an older Tavora), `height` takes it
   * from the frame's height (a Tavora frame, which follows the text), `down` only shrinks it (a preview).
   */
  scaleBy: OverlayTextScaleBy;
};

const element = (tag: string, className: string): HTMLElement => Object.assign(document.createElement(tag), { className });
/** A share of the 100 % size, as a CSS length relative to the element around it. */
const em = (share: number) => `${Number(share.toFixed(4))}em`;

export function mountOverlayView(root: HTMLElement, options: OverlayViewOptions): OverlayView {
  root.classList.add("cc-ov");
  // 100 % is the number at M: VALUE_PX in a 1080 px high window. Every size inside is a share of it.
  const text = mountOverlayText(root, { padding: options.padding, scaleBy: options.scaleBy, fontSize: VALUE_PX });
  const line = element("div", "cc-line");
  const lap = element("div", "cc-lap");
  text.content.append(line, lap);
  /** What is drawn now, so a clock that is drawn again every tick changes nothing until its text does. */
  let drawn = "";
  let boxed = "";

  function draw(state: OverlayState | null, now = Date.now()): void {
    root.hidden = state === null;
    // A hidden view has nothing to scroll.
    text.setActive(state !== null);
    if (!state) return;
    const { look } = state;
    const shown = lineOf(state, now);
    root.style.setProperty("--color", look.color);
    root.style.setProperty("--words", look.wordsColor ?? look.color);
    root.dataset.font = look.font;
    root.dataset.outline = String(look.outline);
    if (shown.flashing) root.dataset.done = "flash";
    else delete root.dataset.done;
    const box = { ...boxOf(look), align: look.align };
    const options = JSON.stringify(box);
    if (options !== boxed) {
      boxed = options;
      text.configure(box);
    }
    const sizes = sizeScales(look);
    const content = JSON.stringify([shown.segments, shown.lap, sizes, root.dataset.font]);
    if (content === drawn) return;
    drawn = content;
    // The line box takes the biggest run, so the height is the same however the runs are mixed; each run is a share of it.
    const hasNumber = shown.segments.some((part) => part.value);
    const hasWords = shown.segments.some((part) => !part.value);
    const biggest = Math.max(hasNumber ? sizes.number : 0, hasWords ? sizes.words : 0) || 1;
    line.style.fontSize = em(biggest);
    line.replaceChildren(
      ...shown.segments.map((part) => {
        const run = element("span", part.value ? "cc-n" : "cc-w");
        run.textContent = part.text;
        run.style.fontSize = em((part.value ? sizes.number : sizes.words) / biggest);
        return run;
      }),
    );
    lap.textContent = shown.lap;
    lap.style.fontSize = em(sizes.number * LAP_SHARE);
    // The words name what is shown: while they stay, a value that changes (a tick, a count) goes on scrolling where it is.
    text.refresh(shown.segments.map((part) => (part.value ? "" : part.text)).join("\u0000"));
  }

  return { draw, fit: () => text.fit() };
}
