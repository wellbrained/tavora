// A compact dense two-phase simplex for the planner's small linear programs
// (a few hundred variables at most). Pure TypeScript, no dependencies.

/** One equality constraint: the sum of coefficient × variable equals rhs. */
export interface Constraint {
  terms: [variable: number, coefficient: number][];
  rhs: number;
}

const EPSILON = 1e-9;
const MAX_PIVOTS = 100_000;
/** Pivots without progress before switching to Bland's rule, which cannot cycle. */
const DEGENERATE_LIMIT = 50;

/**
 * Minimises costs · x subject to the constraints and x ≥ 0. Returns x, or null when no x satisfies
 * the constraints. Throws when the objective has no lower bound (never the case with costs ≥ 0).
 */
export function minimise(costs: number[], constraints: Constraint[]): number[] | null {
  const n = costs.length;
  const m = constraints.length;
  const width = n + m + 1;
  const rhs = width - 1;
  const scale = Math.max(1, ...constraints.map((row) => Math.abs(row.rhs)));

  // Tableau with one artificial variable per row, so the artificials form the first basis.
  const table = constraints.map((row, i) => {
    const line = new Float64Array(width);
    const sign = row.rhs < 0 ? -1 : 1;
    for (const [variable, coefficient] of row.terms) line[variable]! += sign * coefficient;
    line[n + i] = 1;
    line[rhs] = sign * row.rhs;
    return line;
  });
  const basis = constraints.map((_, i) => n + i);

  // Phase 1: minimise the sum of the artificials.
  const objective = new Float64Array(width);
  for (const line of table) {
    for (let j = 0; j < n; j++) objective[j]! -= line[j]!;
    objective[rhs]! -= line[rhs]!;
  }
  run(table, basis, objective, width, n + m);
  if (-objective[rhs]! > EPSILON * scale) return null;

  // Move artificials still in the basis (at zero) out wherever the row allows it.
  for (let i = 0; i < m; i++) {
    if (basis[i]! < n) continue;
    const line = table[i]!;
    let column = -1;
    for (let j = 0; j < n; j++) if (Math.abs(line[j]!) > EPSILON && (column < 0 || Math.abs(line[j]!) > Math.abs(line[column]!))) column = j;
    if (column >= 0) pivot(table, basis, objective, i, column, width);
  }

  // Phase 2: the real costs, artificials may no longer enter.
  objective.fill(0);
  for (let j = 0; j < n; j++) objective[j] = costs[j]!;
  table.forEach((line, i) => {
    const cost = basis[i]! < n ? costs[basis[i]!]! : 0;
    if (cost === 0) return;
    for (let j = 0; j < width; j++) objective[j]! -= cost * line[j]!;
  });
  if (!run(table, basis, objective, width, n)) throw new Error("The linear program is unbounded.");

  const x = new Array<number>(n).fill(0);
  basis.forEach((variable, i) => {
    if (variable < n) x[variable] = Math.max(0, table[i]![rhs]!);
  });
  return x;
}

/** Pivots until no column below `entering` improves the objective. False when unbounded. */
function run(table: Float64Array[], basis: number[], objective: Float64Array, width: number, entering: number): boolean {
  const rhs = width - 1;
  let stalled = 0;
  for (let step = 0; step < MAX_PIVOTS; step++) {
    const bland = stalled >= DEGENERATE_LIMIT;
    let column = -1;
    for (let j = 0; j < entering; j++) {
      if (objective[j]! >= -EPSILON) continue;
      if (column < 0 || (!bland && objective[j]! < objective[column]!)) column = j;
      if (bland) break;
    }
    if (column < 0) return true;

    let row = -1;
    let best = Infinity;
    table.forEach((line, i) => {
      if (line[column]! <= EPSILON) return;
      const ratio = line[rhs]! / line[column]!;
      if (ratio < best - EPSILON || (ratio <= best + EPSILON && row >= 0 && basis[i]! < basis[row]!)) {
        best = ratio;
        row = i;
      }
    });
    if (row < 0) return false;
    stalled = best <= EPSILON ? stalled + 1 : 0;
    pivot(table, basis, objective, row, column, width);
  }
  throw new Error("The linear program did not settle.");
}

function pivot(table: Float64Array[], basis: number[], objective: Float64Array, row: number, column: number, width: number): void {
  const line = table[row]!;
  const factor = line[column]!;
  for (let j = 0; j < width; j++) line[j]! /= factor;
  line[column] = 1;
  for (const other of [...table, objective]) {
    if (other === line) continue;
    const times = other[column]!;
    if (times === 0) continue;
    for (let j = 0; j < width; j++) other[j]! -= times * line[j]!;
    other[column] = 0;
  }
  basis[row] = column;
}
