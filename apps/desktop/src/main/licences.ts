import { readFileSync } from "node:fs";
import type { LicenceEntry, LicenceList } from "../shared/host-api";

const GROUPS = new Set(["libraries", "fonts", "helper"]);

/** True for one package of the notices file; the file is ours, but a half-written one must not reach the page. */
function isEntry(value: unknown, textCount: number): value is LicenceEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.name === "string" &&
    typeof e.version === "string" &&
    typeof e.license === "string" &&
    typeof e.group === "string" &&
    GROUPS.has(e.group) &&
    Array.isArray(e.texts) &&
    e.texts.every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < textCount)
  );
}

/** The notices the build wrote (scripts/licences.mjs); null when the file is missing or isn't what the build writes. */
export function readLicences(file: string): LicenceList | null {
  try {
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof data !== "object" || data === null) return null;
    const { entries, texts } = data as { entries?: unknown; texts?: unknown };
    if (!Array.isArray(entries) || !Array.isArray(texts) || !texts.every((text) => typeof text === "string")) return null;
    return entries.every((entry) => isEntry(entry, texts.length)) ? { entries: entries as LicenceEntry[], texts: texts as string[] } : null;
  } catch {
    return null;
  }
}
