// What a name dialog accepts: not empty (after trimming) and no longer than the limit.
export type NameProblem = "empty" | "tooLong" | null;

export const DEFAULT_NAME_LIMIT = 100;

/** The text a name field shows when the `value` prop changes: the new value, unless the user already typed (their text wins). */
export function followValue(text: string, typed: boolean, value: string): string {
  return typed ? text : value;
}

export function checkName(value: string, max = DEFAULT_NAME_LIMIT): NameProblem {
  const name = value.trim();
  if (!name) return "empty";
  return name.length > max ? "tooLong" : null;
}
