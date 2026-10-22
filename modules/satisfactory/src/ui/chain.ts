// The solved plan as a production chain: each target a tree from the product down to
// the raw resources. An item used by several parents shows under each with its share.

import type { ItemId } from "../contracts/data";
import type { PlanResult, Rate, RecipeRow } from "../contracts/plan";

/** Where a part of an item comes from when no row of its own makes it. */
export type ChainSource = "raw" | "import" | "supplied" | "byproduct";

export interface ChainPart {
  source: ChainSource;
  perMinute: number;
  /** For a byproduct: the item of the row that gives it off. */
  from?: ItemId;
}

export interface ChainNode {
  /** The path from the root, such as "0.2.1"; stays the same while the plan keeps its shape. */
  key: string;
  item: ItemId;
  /** What the parent needs (for a root, the target). */
  perMinute: number;
  /** The row making this item, or null when it all comes from elsewhere. */
  row: RecipeRow | null;
  /** This branch's share of the row's exact machines; 0 without a row. */
  machines: number;
  /** What does not come from the row: supplied, raw, brought in or a byproduct. */
  parts: ChainPart[];
  /** The item already appears higher up this branch: a recipe loop, so it stops here. */
  loop: boolean;
  /** The chain grew past MAX_NODES before this node's inputs were added. */
  cut: boolean;
  children: ChainNode[];
}

/** Big plans repeat shared items in every branch; past this the rest is left to the list. */
export const MAX_NODES = 3000;

/** Rates below this are rounding noise. */
const NOISE = 1e-9;

interface Sources {
  row: RecipeRow | null;
  /** What the row makes of the item. */
  made: number;
  parts: ChainPart[];
  total: number;
}

export function productionChain(result: PlanResult, targets: Rate[]): ChainNode[] {
  const own = new Map<ItemId, RecipeRow>();
  for (const row of result.rows) if (!own.has(row.item)) own.set(row.item, row);

  const cache = new Map<ItemId, Sources>();
  const sourcesOf = (item: ItemId): Sources => {
    let found = cache.get(item);
    if (found) return found;
    const row = own.get(item) ?? null;
    const made = row ? outputOf(row, item) : 0;
    const parts: ChainPart[] = [];
    const add = (source: ChainSource, rates: Rate[]) => {
      const perMinute = rates.filter((rate) => rate.item === item).reduce((sum, rate) => sum + rate.perMinute, 0);
      if (perMinute > NOISE) parts.push({ source, perMinute });
    };
    add("supplied", result.fixedInputsUsed);
    for (const other of result.rows) {
      const given = other === row ? 0 : outputOf(other, item);
      if (given > NOISE) parts.push({ source: "byproduct", perMinute: given, from: other.item });
    }
    add("raw", result.rawResources);
    add("import", result.imports);
    const total = parts.reduce((sum, part) => sum + part.perMinute, made);
    cache.set(item, (found = { row: made > NOISE ? row : null, made, parts, total }));
    return found;
  };

  let count = 0;
  const node = (item: ItemId, perMinute: number, key: string, above: ItemId[]): ChainNode => {
    count++;
    const base = { key, item, perMinute: clean(perMinute), row: null, machines: 0, parts: [], loop: false, cut: false, children: [] };
    if (above.includes(item)) return { ...base, loop: true };
    const sources = sourcesOf(item);
    // Every consumer takes the same share of every source, so the parts add up to what it needs.
    const share = sources.total > NOISE ? perMinute / sources.total : 0;
    const parts = sources.parts.map((part) => ({ ...part, perMinute: clean(part.perMinute * share) })).filter((part) => part.perMinute > NOISE);
    const row = sources.row;
    if (!row) return { ...base, parts };
    const machines = clean(row.machines * share);
    if (count >= MAX_NODES) return { ...base, row, machines, parts, cut: row.inputs.length > 0 };
    const path = [...above, item];
    const children = row.inputs
      .filter((input) => input.perMinute * share > NOISE)
      .map((input, index) => node(input.item, input.perMinute * share, `${key}.${index}`, path));
    return { ...base, row, machines, parts, children };
  };

  return targets.map((target, index) => node(target.item, target.perMinute, String(index), []));
}

function outputOf(row: RecipeRow, item: ItemId): number {
  return row.outputs.filter((rate) => rate.item === item).reduce((sum, rate) => sum + rate.perMinute, 0);
}

/** Drops floating-point noise, as the solver does. */
function clean(value: number): number {
  return Math.abs(value) < NOISE ? 0 : Number(value.toPrecision(12));
}
