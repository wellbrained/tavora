// Numbers as the Planner and Codex show them, in the player's locale.

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, digits: number): Intl.NumberFormat {
  const key = `${locale}|${digits}`;
  let found = formatters.get(key);
  if (!found) formatters.set(key, (found = new Intl.NumberFormat(locale, { maximumFractionDigits: digits })));
  return found;
}

/** Up to `digits` decimals, trailing zeros dropped; tiny rounding noise shows as 0. */
export function formatNumber(value: number, locale: string, digits = 2): string {
  const clean = Math.abs(value) < 1e-9 ? 0 : value;
  return formatter(locale, digits).format(clean);
}

/** A number for a text field: up to 4 decimals and no thousands separator, so parseRate reads it back. */
export function formatInput(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4, useGrouping: false }).format(value);
}

/** A rate per minute: 2 decimals. */
export const formatRate = (value: number, locale: string) => formatNumber(value, locale, 2);

/** A clock speed: up to 2 decimals. */
export const formatClock = (value: number, locale: string) => `${formatNumber(value, locale, 2)} %`;

/** Power in MW, or GW from 1000 MW. */
export function formatPower(megawatts: number, locale: string): string {
  return megawatts >= 1000 ? `${formatNumber(megawatts / 1000, locale, 2)} GW` : `${formatNumber(megawatts, locale, 1)} MW`;
}
