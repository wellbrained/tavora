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

/**
 * What decides the line's size: the runs with their sizes, the words as they are and every digit as a 0 (the digits are
 * tabular, so all as wide). Two texts of the same shape are as big, and the second needs no measuring.
 */
function shapeOf(runs: { className: string; text: string; size: string }[], lap: string, lineSize: string, lapSize: string): string {
  const digits = (text: string) => text.replace(/\d/g, "0");
  return JSON.stringify([runs.map((run) => [run.className, run.className === "cc-n" ? digits(run.text) : run.text, run.size]), digits(lap), lineSize, lapSize]);
}

export function mountOverlayView(root: HTMLElement, options: OverlayViewOptions): OverlayView {
  root.classList.add("cc-ov");
  const text = mountOverlayText(root, { padding: options.padding });
  const line = element("div", "cc-line");
  const lap = element("div", "cc-lap");
  text.content.replaceChildren(line, lap);
  let key: string | null = null;
  let applied = "";
  /** What was drawn last, exactly and as a shape (see shapeOf). */
  let drawn = "";
  let drawnShape = "";

  function draw(state: OverlayState | null, now = Date.now()): void {
    root.hidden = state === null;
    if (!state) {
      drawn = drawnShape = "";
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
    const lineSize = px(Math.max(hasNumber ? sizes.number : 0, hasWords ? sizes.words : 0));
    const runs = shown.segments.map((part) => ({ className: part.value ? "cc-n" : "cc-w", text: part.text, size: px(part.value ? sizes.number : sizes.words) }));
    const lapSize = px(sizes.number * LAP_SHARE);

    const box = boxOf(look);
    const settings: Partial<OverlayTextOptions> =
      options.preview && box.mode === "grow" ? { ...box, mode: "fixed", overflow: "shrink", align: look.align } : { ...box, align: look.align, gap: VALUE_PX * sizes.number };
    const settingsKey = JSON.stringify(settings);
    const exact = JSON.stringify([runs, shown.lap, lineSize, lapSize]);
    // A clock draws four times a second, and its time changes once a second: the same text again changes nothing, and a
    // new time of the same shape (tabular digits are all as wide) only takes the new digits, with nothing measured.
    const shape = shapeOf(runs, shown.lap, lineSize, lapSize);
    if (settingsKey === applied && exact === drawn) return;
    if (settingsKey === applied && shape === drawnShape) {
      runs.forEach((run, index) => (line.children[index]!.textContent = run.text));
      lap.textContent = shown.lap;
      drawn = exact;
      text.mirror();
      return;
    }
    line.style.setProperty("--size", lineSize);
    line.replaceChildren(
      ...runs.map((part) => {
        const run = element("span", part.className);
        run.textContent = part.text;
        run.style.setProperty("--size", part.size);
        return run;
      }),
    );
    lap.style.setProperty("--size", lapSize);
    lap.textContent = shown.lap;
    drawn = exact;
    drawnShape = shape;

    const next = wordsOf(state, shown.segments);
    const restart = key !== null && next !== key;
    key = next;
    // New settings fit it themselves (once); otherwise the new text does.
    if (settingsKey !== applied) {
      applied = settingsKey;
      text.set(settings);
      if (restart) text.changed(true);
    } else text.changed(restart);
  }

  return { draw, fit: () => text.fit(), destroy: () => text.destroy() };
}
