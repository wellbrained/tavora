// Draws one item's overlay text into an element: the page OBS shows uses it with the whole window as its box, and the settings
// use it for their live preview, so what is previewed is what is drawn. The line is runs of words and values (template.ts); each
// has its own colour and size, the number keeps its tabular digits. The kit's overlay text (OverlayText) sizes it in its box:
// grown with the frame, or at its own size in a fixed box where a line too long scrolls, shrinks or is cut off.
import { mountOverlayText, type OverlayTextOptions } from "@tavora/official-ui/overlay-text";
import { boxOf, sizeScales, type OverlayState } from "./items";
import { lineOf } from "./line";
import { LAP_SHARE, VALUE_PX } from "./sources";
import "./overlay-view.css";

export type OverlayView = {
  /** Draws what `state` shows at `now`, or hides the view for null. */
  draw(state: OverlayState | null, now?: number): void;
  /** Sizes the text again, once the box or the fonts changed. */
  fit(): void;
  destroy(): void;
};

export type OverlayViewOptions = {
  /** The room kept around the text, in pixels of the box. */
  padding: number;
  /**
   * The preview in the settings: a text that grows with its frame is shown at its natural size and only shrinks to fit the
   * preview, since the preview is not its frame.
   */
  preview?: boolean;
};

const element = (tag: string, className: string): HTMLElement => Object.assign(document.createElement(tag), { className });

/** What tells one text from the next: the words. A value that changes (a counter ticks) is the same text, so a scroll runs on. */
const wordsOf = (state: OverlayState, segments: { text: string; value: boolean }[]) => `${state.kind}:${segments.filter((part) => !part.value).map((part) => part.text).join("")}`;

export function mountOverlayView(root: HTMLElement, options: OverlayViewOptions): OverlayView {
  root.classList.add("cc-ov");
  const text = mountOverlayText(root, { padding: options.padding });
  const line = element("div", "cc-line");
  const lap = element("div", "cc-lap");
  text.content.replaceChildren(line, lap);
  let key: string | null = null;
  let applied = "";

  function draw(state: OverlayState | null, now = Date.now()): void {
    root.hidden = state === null;
    if (!state) {
      text.fit();
      return;
    }
    const { look } = state;
    const shown = lineOf(state, now);
    root.style.setProperty("--color", look.color);
    root.style.setProperty("--words", look.wordsColor ?? look.color);
    root.dataset.font = look.font;
    root.dataset.outline = String(look.outline);
    if (shown.flashing) root.dataset.done = "flash";
    else delete root.dataset.done;

    // Each run's size at the natural size, in px; the kit multiplies it with the scale of the box.
    const sizes = sizeScales(look);
    const px = (share: number) => `${VALUE_PX * share}px`;
    const hasNumber = shown.segments.some((part) => part.value);
    const hasWords = shown.segments.some((part) => !part.value);
    // The line box takes the biggest run, so the height is the same however the runs are mixed.
    line.style.setProperty("--size", px(Math.max(hasNumber ? sizes.number : 0, hasWords ? sizes.words : 0)));
    line.replaceChildren(
      ...shown.segments.map((part) => {
        const run = element("span", part.value ? "cc-n" : "cc-w");
        run.textContent = part.text;
        run.style.setProperty("--size", px(part.value ? sizes.number : sizes.words));
        return run;
      }),
    );
    lap.style.setProperty("--size", px(sizes.number * LAP_SHARE));
    lap.textContent = shown.lap;

    const box = boxOf(look);
    const settings: Partial<OverlayTextOptions> =
      options.preview && box.mode === "grow" ? { ...box, mode: "fixed", overflow: "shrink", align: look.align } : { ...box, align: look.align, gap: VALUE_PX * sizes.number };
    // Set only when they changed: a clock draws four times a second.
    if (JSON.stringify(settings) !== applied) {
      applied = JSON.stringify(settings);
      text.set(settings);
    }
    const next = wordsOf(state, shown.segments);
    text.changed(key !== null && next !== key);
    key = next;
  }

  return { draw, fit: () => text.fit(), destroy: () => text.destroy() };
}
