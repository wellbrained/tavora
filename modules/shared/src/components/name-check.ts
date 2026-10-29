// What a name dialog accepts: not empty (after trimming) and no longer than the limit.
export type NameProblem = "empty" | "tooLong" | null;

export const DEFAULT_NAME_LIMIT = 100;

export function checkName(value: string, max = DEFAULT_NAME_LIMIT): NameProblem {
  const name = value.trim();
  if (!name) return "empty";
  return name.length > max ? "tooLong" : null;
}
