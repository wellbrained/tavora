/**
 * Whether one folder or file lies in another, by their paths alone: the one answer for every guard that decides what
 * a module may reach (folder-access.ts, module-files.ts, assets.ts, the admin panel's page folder).
 *
 * - Both paths are resolved first (`..` and `.` segments, doubled and trailing separators and, on Windows, `/` vs `\`
 *   are settled), so a relative path means "from the current folder"; pass real, absolute paths.
 * - On Windows the comparison ignores case (the file system does too); elsewhere it is exact. Folders made
 *   case-sensitive on Windows (WSL) are not told apart.
 * - It is a whole-name match: `C:\a` holds `C:\a\b` and not `C:\ab`; a folder literally called `..x` is inside.
 * - Another drive or another UNC share is never inside.
 * - Links are not followed: a caller that must see through junctions or symlinks resolves the real paths first
 *   (realpath) and asks about those.
 *
 * Depends on nothing but `node:path` so apps/api can load it too.
 */
import path from "node:path";

export interface PathChecks {
  /** `inner` is `outer` or lies below it. */
  isInsideOrSame(inner: string, outer: string): boolean;
  /** `inner` lies below `outer`, and is not `outer` itself. */
  isInside(inner: string, outer: string): boolean;
}

/** The two checks for one path flavour (`path.win32` / `path.posix` in tests; `path` for the real thing). */
export function pathChecks(api: Pick<typeof path, "relative" | "resolve" | "isAbsolute" | "sep">): PathChecks {
  /** "" for the same place, null for a place outside, else the way down. */
  const below = (inner: string, outer: string): string | null => {
    const way = api.relative(api.resolve(outer), api.resolve(inner));
    if (way === "") return "";
    // Another drive or share has no relative way: it comes back absolute.
    if (api.isAbsolute(way) || way === ".." || way.startsWith(`..${api.sep}`)) return null;
    return way;
  };
  return {
    isInsideOrSame: (inner, outer) => below(inner, outer) !== null,
    isInside: (inner, outer) => (below(inner, outer) ?? "") !== "",
  };
}

// path.win32.relative ignores case itself; posix is exact.
export const { isInsideOrSame, isInside } = pathChecks(path);
