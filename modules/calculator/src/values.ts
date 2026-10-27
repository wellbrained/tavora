// The player's named values, newest first, kept in the workspace's module storage so every panel of the workspace has them.
// A sum holds a value by its name and looks up its number when it is worked out.
import type { JsonValue } from "@tavora/sdk";
import type { Lookup } from "./calc";

export type Value = {
  /** Letters and digits only, so it can sit in a sum. */
  name: string;
  /** The number, as the calculator writes it. */
  value: string;
};

export const VALUES_KEY = "values";
export const MAX_VALUES = 30;
export const MAX_NAME = 20;

/** Whether a name can be used: 1 to 20 letters or digits, in any language. */
export const isValidName = (name: string) => name.length > 0 && name.length <= MAX_NAME && /^[\p{L}\p{N}]+$/u.test(name);

/** Names match whatever the case, so Iron and iron are the same value. */
export const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Turns what storage holds into valid values, dropping anything broken. */
export function parseValues(raw: JsonValue | null): Value[] {
  if (!Array.isArray(raw)) return [];
  const values: Value[] = [];
  for (const item of raw) {
    const entry = item as Record<string, unknown> | null;
    if (typeof entry?.name !== "string" || typeof entry.value !== "string") continue;
    if (!isValidName(entry.name) || !Number.isFinite(Number(entry.value))) continue;
    if (values.some((value) => sameName(value.name, entry.name as string))) continue;
    values.push({ name: entry.name, value: entry.value });
  }
  return values.slice(0, MAX_VALUES);
}

/** Saves a number under a name on top; the same name is replaced. Null when the list is full and the name is new. */
export function saveValue(values: Value[], value: Value): Value[] | null {
  const others = values.filter((item) => !sameName(item.name, value.name));
  if (others.length >= MAX_VALUES) return null;
  return [value, ...others];
}

/** Gives a value a new name in its place. Null when another value has that name already. */
export function renameValue(values: Value[], from: string, to: string): Value[] | null {
  if (values.some((item) => sameName(item.name, to) && !sameName(item.name, from))) return null;
  return values.map((item) => (sameName(item.name, from) ? { ...item, name: to } : item));
}

export function deleteValue(values: Value[], name: string): Value[] {
  return values.filter((item) => !sameName(item.name, name));
}

/** Finds a value's number by name, for working out a sum. */
export function lookup(values: Value[]): Lookup {
  return (name) => {
    const found = values.find((item) => sameName(item.name, name));
    return found ? Number(found.value) : undefined;
  };
}
