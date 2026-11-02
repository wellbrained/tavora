// The motion tokens (motion.css) for code that animates with the Web Animations API, which cannot read `var()`.
// Read when an animation starts, so a theme or a test that changes them is followed.

/** The user asked their system for less movement. */
export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}

function token(name: string): string {
  if (typeof document === "undefined") return ""
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** A duration token such as `--duration-panel`, in milliseconds. */
export function motionDuration(name: string, fallback: number): number {
  const value = token(name)
  const number = Number.parseFloat(value)
  if (!Number.isFinite(number)) return fallback
  return value.endsWith("ms") ? number : value.endsWith("s") ? number * 1000 : fallback
}

/** A curve token such as `--ease-out-strong`. */
export function motionEase(name: string, fallback: string): string {
  return token(name) || fallback
}
