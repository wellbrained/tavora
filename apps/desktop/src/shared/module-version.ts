/**
 * The order of two whole numbers written out, however long: past about 16 digits a JavaScript number would call
 * neighbours equal (audit 2026-11-28). Never throws, so a part that is no number still compares.
 */
function compareWhole(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, "");
  const y = b.replace(/^0+(?=\d)/, "");
  if (x.length !== y.length) return x.length - y.length;
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * Semver order of two valid manifest versions: below 0 when a is older, 0 when they are the same,
 * above 0 when a is newer. A pre-release (1.0.0-beta.1) comes before its release, and pre-release
 * parts compare as semver says: numbers by value, below words, words by their characters.
 */
export function compareModuleVersions(a: string, b: string): number {
  const split = (version: string) => {
    const [core = "", pre] = version.split(/-(.*)/s);
    return { core: core.split("."), pre: pre === undefined ? [] : pre.split(".") };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) {
    const order = compareWhole(x.core[i] ?? "", y.core[i] ?? "");
    if (order !== 0) return order;
  }
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]!;
    const q = y.pre[i]!;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return compareWhole(p, q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length - y.pre.length;
}
