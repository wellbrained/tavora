// The number rules behind SliderField's editable box, kept apart from the component so they can be tested on their own.

/** How many decimals a step (or limit) has: 0.25 has two. */
export function decimalCount(value: number): number {
  const text = String(value)
  const dot = text.indexOf(".")
  return dot === -1 ? 0 : text.length - dot - 1
}

/**
 * What the user typed as a number, or `null` when it isn't one. A comma works as the decimal mark (German "2,5"); spaces
 * around it are ignored. Units, letters and empty text are not numbers.
 */
export function parseTyped(text: string): number | null {
  const trimmed = text.trim()
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(trimmed)) return null
  const value = Number(trimmed.replace(",", "."))
  return Number.isFinite(value) ? value : null
}

/** Moves a value onto the slider's grid (`min` plus whole steps), then keeps it between `min` and `max`, like the slider itself does. */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  const decimals = Math.max(decimalCount(step), decimalCount(min))
  const snapped = Number((Math.round((value - min) / step) * step + min).toFixed(decimals))
  return Math.min(max, Math.max(min, snapped))
}

/** What committing the typed text gives: the snapped number, or `null` when the text is not a number (the box then goes back). */
export function commitTyped(text: string, min: number, max: number, step: number): number | null {
  const value = parseTyped(text)
  return value === null ? null : snapToStep(value, min, max, step)
}
