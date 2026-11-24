/** `value` held between `low` and `high`. */
export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
