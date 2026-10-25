/** Where each value sits in a chart `width` x `height` pixels, with `pad` pixels kept free at the top and bottom. Fewer than 2 values draw nothing. */
export function sparkPoints(values: readonly number[], width: number, height: number, min: number, max: number, pad = 1): [number, number][] {
  if (values.length < 2 || width <= 0 || height <= 0) return []
  const span = max - min || 1
  const inner = Math.max(0, height - pad * 2)
  const step = width / (values.length - 1)
  return values.map((value, index) => {
    const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
    return [index * step, pad + inner * (1 - (clamped - min) / span)]
  })
}
