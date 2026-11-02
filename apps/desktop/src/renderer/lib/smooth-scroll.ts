// Scrolls a panel so an element sits in its middle, in the motion tokens' time and curve (motion.css: --duration-move,
// --ease-out-strong). Our own frame loop rather than `scrollIntoView({ behavior: "smooth" })`, whose duration and curve
// are the browser's and which can't tell when it is done. Instant under reduced motion. A wheel, touch, key or click
// from the user stops it where it is.

/** A CSS cubic-bezier as a function from time (0 to 1) to progress (0 to 1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (time: number) => number {
  const at = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  return (time) => {
    if (time <= 0) return 0;
    if (time >= 1) return 1;
    // Find the curve parameter whose x is `time`, by bisection (the curve's x only ever goes forward).
    let low = 0;
    let high = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (low + high) / 2;
      if (at(x1, x2, mid) < time) low = mid;
      else high = mid;
    }
    return at(y1, y2, (low + high) / 2);
  };
}

/** --ease-out-strong. */
export const easeOutStrong = cubicBezier(0.23, 1, 0.32, 1);

/**
 * Where the panel has to scroll to put the element in its middle: never above the top or below the end. Distances are
 * measured on the screen, so the panel's own padding and borders don't matter.
 */
export function centeredTop(box: { top: number; height: number }, target: { top: number; height: number }, scrollTop: number, scrollHeight: number): number {
  const wanted = scrollTop + (target.top - box.top) - (box.height - target.height) / 2;
  return Math.min(Math.max(0, wanted), Math.max(0, scrollHeight - box.height));
}

/** A time custom property such as `--duration-move: 300ms`, in milliseconds. */
function duration(name: string, fallback: number): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const amount = Number.parseFloat(value);
  if (Number.isNaN(amount)) return fallback;
  return value.endsWith("ms") ? amount : amount * 1000;
}

/** What the user does to take the scrolling over. */
const TAKEOVER = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

let stopRunning: (() => void) | null = null;

/** Scrolls `scroller` until `target` is in its middle; resolves when it has got there (or the user took over). */
export function scrollToCentered(scroller: HTMLElement, target: Element): Promise<void> {
  stopRunning?.();
  const top = centeredTop(scroller.getBoundingClientRect(), target.getBoundingClientRect(), scroller.scrollTop, scroller.scrollHeight);
  const from = scroller.scrollTop;
  const distance = top - from;
  if (Math.abs(distance) < 1) return Promise.resolve();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    scroller.scrollTop = top;
    return Promise.resolve();
  }
  const length = duration("--duration-move", 300);
  return new Promise((resolve) => {
    let frame = 0;
    const begin = performance.now();
    const stop = () => {
      cancelAnimationFrame(frame);
      for (const kind of TAKEOVER) scroller.removeEventListener(kind, stop);
      if (stopRunning === stop) stopRunning = null;
      resolve();
    };
    const step = (now: number) => {
      const time = Math.min(1, (now - begin) / length);
      scroller.scrollTop = from + distance * easeOutStrong(time);
      if (time < 1) frame = requestAnimationFrame(step);
      else stop();
    };
    for (const kind of TAKEOVER) scroller.addEventListener(kind, stop, { passive: true });
    stopRunning = stop;
    frame = requestAnimationFrame(step);
  });
}
