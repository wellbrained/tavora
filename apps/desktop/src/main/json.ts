import { readFile, rename } from "node:fs/promises";
import type { JsonValue } from "@tavora/sdk/protocol";
import { HostError } from "./errors";

const MAX_DEPTH = 64;

/** Accepts only plain JSON data: no Dates, Maps, typed arrays, NaN or cycles. */
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value).every((item) => isJsonValue(item, depth + 1));
  }
  return false;
}

/** Serializes a value after checking it is plain JSON. */
export function serializeJson(value: unknown, what: string): string {
  if (!isJsonValue(value)) throw new HostError("INVALID_PARAMS", `${what} must be plain JSON data`);
  return JSON.stringify(value);
}

/** Renames a file aside (never overwrites it), so a newer or unreadable file is kept and the store starts empty. */
export async function setAside(file: string): Promise<void> {
  await rename(file, `${file}.corrupt-${Date.now()}`);
  console.error(`[tavora] unreadable file has been set aside: ${file}`);
}

/**
 * Reads a JSON file. Missing gives null; unreadable JSON is renamed aside
 * (never overwritten) and also gives null.
 */
export async function readJsonOrSetAside<T>(file: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    await setAside(file);
    return null;
  }
}
