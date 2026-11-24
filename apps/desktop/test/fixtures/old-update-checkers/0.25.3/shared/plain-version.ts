/**
 * Plain `major.minor.patch` versions: Tavora's own app version, the update feed's version and the release scripts' tags.
 * (Module versions may carry a pre-release and live in module-version.ts.) One strict reader and one order, so a
 * malformed version is never "equal" to anything and never "newer" than anything.
 *
 * Imports nothing, because the release scripts (plain Node) and apps/api load it too.
 */

/** No leading zeros, at most nine digits a part: what `updateProblem` in update-signature.ts has always accepted. */
const PLAIN = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
/** The tolerant reader behind `compareVersionsLoose`: a leading x.y.z, whatever follows. */
const LEADING = /^(\d+)\.(\d+)\.(\d+)/;

export type VersionParts = readonly [number, number, number];

/** The three numbers of a plain x.y.z version, or null for anything else (`1.2`, `1.2.x`, `01.2.3`, `1.2.3-beta`, ``, not a string). */
export function parsePlainVersion(version: unknown): VersionParts | null {
  if (typeof version !== "string") return null;
  const match = PLAIN.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareParts(a: VersionParts, b: VersionParts): -1 | 0 | 1 {
  for (let index = 0; index < 3; index++) {
    if (a[index]! !== b[index]!) return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
}

/** -1, 0 or 1 for two plain x.y.z versions; null when either one is not (the caller decides what that means, it is never an order). */
export function comparePlainVersions(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const left = parsePlainVersion(a);
  const right = parsePlainVersion(b);
  return left && right ? compareParts(left, right) : null;
}

/** The admin panel's reading: the leading x.y.z of a string counts, anything else counts as 0.0.0. Display only, never a guard. */
export function compareVersionsLoose(a: string, b: string): -1 | 0 | 1 {
  const parts = (version: string): VersionParts => {
    const match = LEADING.exec(version);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  };
  return compareParts(parts(a), parts(b));
}
