import { onScopeDispose, readonly, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from "vue"
import { countAt } from "./tween"

export interface CountToOptions {
  /** Places after the point the number counts in. Whole numbers by default. */
  decimals?: number
  /** Milliseconds. By default the kit's `--duration-move` (300). */
  duration?: number
}

const FALLBACK_DURATION = 300

/** `--duration-move` from the page, so the kit's one number rules; 300 where it is not set or there is no page. */
function kitDuration(): number {
  if (typeof document === "undefined") return FALLBACK_DURATION
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--duration-move").trim()
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return FALLBACK_DURATION
  return raw.endsWith("ms") ? value : raw.endsWith("s") ? value * 1000 : FALLBACK_DURATION
}

/** No animation: reduced motion asked for, or no way to run one (a test, a page that isn't shown). */
function still(): boolean {
  if (typeof requestAnimationFrame !== "function" || typeof matchMedia !== "function") return true
  return matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * The number to show, counting to `source` when it changes: it eases out over about 300 ms, and a new target in the
 * middle carries on from where the count is. The first value, reduced motion and a source that is not a finite number
 * show at once. Use it where a number changes in front of the user, never for one that ticks every second, nor for
 * what is typed.
 */
export function useCountTo(source: MaybeRefOrGetter<number>, options: CountToOptions = {}): Readonly<Ref<number>> {
  const shown = ref(toValue(source))
  let frame = 0

  const stop = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  watch(
    () => toValue(source),
    (target) => {
      stop()
      const from = shown.value
      if (!Number.isFinite(target) || !Number.isFinite(from) || from === target || still()) {
        shown.value = target
        return
      }
      const duration = options.duration ?? kitDuration()
      const decimals = options.decimals ?? 0
      let start = 0
      const step = (now: number) => {
        start ||= now
        const progress = duration > 0 ? (now - start) / duration : 1
        shown.value = countAt(from, target, progress, decimals)
        frame = progress >= 1 ? 0 : requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    },
  )

  onScopeDispose(stop)
  return readonly(shown)
}
