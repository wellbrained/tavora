// How the panel writes numbers. Pure, so it is tested on its own. Sizes use 1024 steps like Windows does, so a
// 16 GB memory reads "16 GB" and a "1 TB" drive reads "931 GB", the same as Explorer.
const GB = 1024 ** 3;
const MB = 1024 ** 2;

const formats = new Map<string, Intl.NumberFormat>();

/** A number with a fixed count of decimals in this language (a comma in German). Formatters are kept: they are slow to make. */
export function num(value: number, decimals: number, language = "en"): string {
  const key = `${language}:${decimals}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(language, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false });
    formats.set(key, format);
  }
  return format.format(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** "42", from 41.6: no decimals in the panel. */
export function percent(value: number, language = "en"): string {
  return num(Math.round(clamp(value, 0, 100)), 0, language);
}

/** "7.5 GB", "120 GB", "1.5 TB": one decimal under 10. */
export function size(bytes: number, language = "en"): string {
  const gb = bytes / GB;
  if (gb >= 1024) {
    const tb = gb / 1024;
    return `${num(tb, tb < 10 ? 1 : 0, language)} TB`;
  }
  return `${num(gb, gb < 10 && gb > 0 ? 1 : 0, language)} GB`;
}

/** "3.2 MB/s", "120 MB/s". */
export function speed(bytesPerSec: number, language = "en"): string {
  const mb = bytesPerSec / MB;
  return `${num(mb, mb < 10 ? 1 : 0, language)} MB/s`;
}

/** The number of a speed, for lines that say "MB/s" once: "3.2", "120". */
export function speedNumber(bytesPerSec: number, language = "en"): string {
  const mb = bytesPerSec / MB;
  return num(mb, mb < 10 ? 1 : 0, language);
}

/** Tavora's own memory: "180 MB", or "1.2 GB" from a gigabyte on. */
export function memory(bytes: number, language = "en"): string {
  return bytes >= GB ? size(bytes, language) : `${num(bytes / MB, 0, language)} MB`;
}

export type DriveTone = "ok" | "warning" | "danger";

const LOW_BYTES = 20 * GB;

/** Yellow under 10 % or 20 GB free, red under 5 % free. A drive of unknown size has no colour. */
export function driveTone(freeBytes: number | null, totalBytes: number | null): DriveTone {
  if (freeBytes === null || totalBytes === null || totalBytes <= 0) return "ok";
  const free = (freeBytes / totalBytes) * 100;
  if (free < 5) return "danger";
  if (free < 10 || freeBytes < LOW_BYTES) return "warning";
  return "ok";
}

/** The share used, 0 to 100, for a bar. */
export function usedPercent(freeBytes: number | null, totalBytes: number | null): number {
  if (freeBytes === null || totalBytes === null || totalBytes <= 0) return 0;
  return clamp(100 - (freeBytes / totalBytes) * 100, 0, 100);
}
