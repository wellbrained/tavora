// The text of an overlay in its box (see plan.ts for the rules): the caller fills `content` and sizes what is in it with
// `calc(<natural px> * var(--overlay-text-scale))`; this measures it, sets the scale, and scrolls, shrinks or cuts off a
// text too long for a fixed box. Plain DOM, so an overlay page without Vue uses it as it is (OverlayText.vue wraps it).
//
// The scroll is cheap enough to run over a game: one transform animation on the compositor (no layout per frame), set up
// again only when the text, the box or a setting changes, and paused while the page is hidden.
import { carryOn, OVERLAY_TEXT_DEFAULTS, planText, scrollRound, type OverlayTextAlign, type OverlayTextSettings, type TextPlan } from "./plan";
import "./overlay-text.css";

/** The CSS variable the content's sizes multiply with. */
export const SCALE_VAR = "--overlay-text-scale";

export interface OverlayTextOptions extends OverlayTextSettings {
  align: OverlayTextAlign;
  /** Room kept around the text inside the box, in px. */
  padding: number;
  /** The gap between the end of a scrolling text and its start coming round again, in px. */
  gap: number;
}

export interface OverlayText {
  /** The element to put the text in. Its children are its lines. */
  readonly content: HTMLElement;
  /** What it does now. */
  readonly plan: TextPlan;
  /** Changes some options and fits again. */
  set(options: Partial<OverlayTextOptions>): void;
  /**
   * Call after the content changed. `restart`: it is a new text (the next song), so a scroll starts its round again;
   * without it (a counter ticks) the scroll goes on where it is.
   */
  changed(restart?: boolean): void;
  /** Measures and fits again, such as once the fonts have loaded. */
  fit(): void;
  /**
   * Call after the content changed in place without changing its size (a clock ticks with tabular digits): the scrolling
   * copy takes the new text, with nothing measured or fitted.
   */
  mirror(): void;
  destroy(): void;
}

const DEFAULTS: OverlayTextOptions = { ...OVERLAY_TEXT_DEFAULTS, align: "center", padding: 0, gap: 48 };

const div = (className: string) => Object.assign(document.createElement("div"), { className });

/**
 * Makes `root` the box of an overlay text. `parts`: a track with the content element in it that is there already (a Vue
 * template renders them); without it they are made and replace what `root` holds.
 */
export function mountOverlayText(root: HTMLElement, initial: Partial<OverlayTextOptions> = {}, parts?: { track: HTMLElement; content: HTMLElement }): OverlayText {
  let options: OverlayTextOptions = { ...DEFAULTS, ...initial };
  root.classList.add("tavora-overlay-text");
  const track = parts?.track ?? div("tavora-overlay-text-track");
  const content = parts?.content ?? div("tavora-overlay-text-content");
  if (!parts) {
    track.append(content);
    root.replaceChildren(track);
  }

  let plan: TextPlan = { kind: "fit", scale: 1 };
  let restart = false;
  let copy: HTMLElement | null = null;
  let animation: Animation | null = null;
  /** The round the animation runs, to tell whether a fit changed it. */
  let round: { distance: number; duration: number; still: number } | null = null;

  const motion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const hidden = () => root.hidden || (typeof document !== "undefined" && document.visibilityState === "hidden");

  function stopScroll(): void {
    animation?.cancel();
    animation = null;
    round = null;
    copy?.remove();
    copy = null;
  }

  /** The copy that follows a scrolling text, made again from the text as it is now. */
  function makeCopy(): void {
    const next = content.cloneNode(true) as HTMLElement;
    next.className = "tavora-overlay-text-copy";
    next.setAttribute("aria-hidden", "true");
    for (const marked of [next, ...Array.from(next.querySelectorAll("[id],[data-testid]"))]) {
      marked.removeAttribute("id");
      marked.removeAttribute("data-testid");
    }
    next.style.marginLeft = `${options.gap}px`;
    if (copy) copy.replaceWith(next);
    else track.append(next);
    copy = next;
  }

  function startScroll(distance: number): void {
    // The copy follows the text, a gap behind it: when the text has run its whole width and the gap, the copy stands where
    // the text started, and the round begins again without a jump.
    makeCopy();
    const { duration, still } = scrollRound(distance, options.speed, options.pause);
    const same = round && round.distance === distance && round.duration === duration && round.still === still;
    if (same && animation && !restart) return;
    const previous = animation && round ? { time: Number(animation.currentTime ?? 0), duration: round.duration } : null;
    animation?.cancel();
    const frames: Keyframe[] = [{ transform: "translateX(0)", offset: 0 }];
    if (still > 0) frames.push({ transform: "translateX(0)", offset: still });
    frames.push({ transform: `translateX(${-distance}px)`, offset: 1 });
    animation = track.animate(frames, { duration, iterations: Infinity, easing: "linear" });
    animation.currentTime = carryOn(previous, duration, restart);
    round = { distance, duration, still };
    if (hidden()) animation.pause();
  }

  function fit(): void {
    if (root.hidden) {
      animation?.pause();
      return;
    }
    // Measured at the natural size, uncut.
    root.style.setProperty(SCALE_VAR, "1");
    delete root.dataset.plan;
    const box = content.getBoundingClientRect();
    const natural = { width: box.width || content.offsetWidth, height: box.height || content.offsetHeight };
    const room = { width: root.clientWidth - 2 * options.padding, height: root.clientHeight - 2 * options.padding };
    plan = planText({ mode: options.mode, overflow: options.overflow, room, natural, reducedMotion: motion?.matches ?? false });
    root.style.setProperty(SCALE_VAR, String(plan.scale));
    root.dataset.plan = plan.kind;
    root.dataset.fade = String(plan.kind === "scroll" && options.softEdges);
    root.style.setProperty("--overlay-text-fade", `${Math.round(Math.min(24, Math.max(room.width, 0) * 0.1))}px`);

    if (plan.kind === "scroll") startScroll(natural.width + options.gap);
    else stopScroll();
    restart = false;
    if (animation && !hidden()) animation.play();
  }

  function apply(): void {
    root.dataset.mode = options.mode;
    root.dataset.align = options.align;
    root.style.padding = `${options.padding}px`;
  }

  const onVisibility = () => {
    if (hidden()) animation?.pause();
    else fit();
  };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => fit()) : null;
  observer?.observe(root);
  motion?.addEventListener?.("change", fit);
  document.addEventListener("visibilitychange", onVisibility);
  apply();

  return {
    content,
    get plan() {
      return plan;
    },
    set(next) {
      const before = options;
      options = { ...options, ...next };
      // A new speed or pause is a new round; the text stays where it is otherwise.
      if (before.speed !== options.speed || before.pause !== options.pause || before.gap !== options.gap) restart = true;
      apply();
      fit();
    },
    changed(again = false) {
      if (again) restart = true;
      fit();
    },
    fit,
    mirror() {
      if (copy) makeCopy();
    },
    destroy() {
      stopScroll();
      observer?.disconnect();
      motion?.removeEventListener?.("change", fit);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
