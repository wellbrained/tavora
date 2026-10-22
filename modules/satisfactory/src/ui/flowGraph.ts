// The solved plan as a flow graph: one box per recipe row with its totals, boxes for what
// comes in and goes out, and an arrow for every item moving between them. Laid out left to
// right with dagre.

import dagre from "@dagrejs/dagre";
import type { ItemId } from "../contracts/data";
import type { PlanResult, Rate, RecipeRow } from "../contracts/plan";
import { clean, NOISE, outputOf } from "./chain";

/** What a box stands for: a recipe row, where an item comes in from, or where it goes. */
export type FlowKind = "recipe" | "raw" | "import" | "supplied" | "target" | "byproduct" | "surplus";

export interface FlowNode {
  id: string;
  kind: FlowKind;
  item: ItemId;
  /** For a recipe, what it makes of its item; otherwise the box's whole rate. */
  perMinute: number;
  row?: RecipeRow;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  item: ItemId;
  perMinute: number;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface Flow {
  node: string;
  perMinute: number;
}

/**
 * Every rate in the plan as an arrow. An item from several sources is shared out the same
 * way to all its users, in proportion to what each source gives, as in the chain.
 */
export function flowGraph(result: PlanResult, targets: Rate[]): FlowGraph {
  const nodes = new Map<string, FlowNode>();
  const add = (node: FlowNode) => {
    const found = nodes.get(node.id);
    if (found) found.perMinute = clean(found.perMinute + node.perMinute);
    else nodes.set(node.id, { ...node, perMinute: clean(node.perMinute) });
    return node.id;
  };

  // Where each item comes from and where it goes.
  const sources = new Map<ItemId, Flow[]>();
  const users = new Map<ItemId, Flow[]>();
  const push = (map: Map<ItemId, Flow[]>, item: ItemId, flow: Flow) => {
    if (flow.perMinute > NOISE) map.set(item, [...(map.get(item) ?? []), flow]);
  };

  result.rows.forEach((row, index) => {
    const id = add({ id: `row:${index}`, kind: "recipe", item: row.item, perMinute: outputOf(row, row.item), row });
    for (const output of row.outputs) push(sources, output.item, { node: id, perMinute: output.perMinute });
    for (const input of row.inputs) push(users, input.item, { node: id, perMinute: input.perMinute });
  });
  const ends = (kind: FlowKind, rates: Rate[], into: Map<ItemId, Flow[]>) => {
    for (const rate of rates) {
      if (rate.perMinute <= NOISE) continue;
      push(into, rate.item, { node: add({ id: `${kind}:${rate.item}`, kind, item: rate.item, perMinute: rate.perMinute }), perMinute: rate.perMinute });
    }
  };
  ends("supplied", result.fixedInputsUsed, sources);
  ends("raw", result.rawResources, sources);
  ends("import", result.imports, sources);
  targets.forEach((target, index) => {
    if (target.perMinute <= NOISE) return;
    push(users, target.item, { node: add({ id: `target:${index}`, kind: "target", item: target.item, perMinute: target.perMinute }), perMinute: target.perMinute });
  });
  ends("byproduct", result.byproducts, users);

  // Left over: what the sources make beyond every use goes out to it; the rest is
  // supply nobody needed, which goes straight out.
  const unusedSupply: FlowEdge[] = [];
  for (const rate of result.surplus) {
    if (rate.perMinute <= NOISE) continue;
    const made = total(sources.get(rate.item));
    const used = total(users.get(rate.item));
    const fromSources = Math.min(rate.perMinute, Math.max(0, made - used));
    const surplus = add({ id: `surplus:${rate.item}`, kind: "surplus", item: rate.item, perMinute: rate.perMinute });
    push(users, rate.item, { node: surplus, perMinute: fromSources });
    const unused = rate.perMinute - fromSources;
    if (unused > NOISE) {
      const supplied = add({ id: `supplied:${rate.item}`, kind: "supplied", item: rate.item, perMinute: unused });
      unusedSupply.push({ id: `${supplied}>${surplus}|${rate.item}`, from: supplied, to: surplus, item: rate.item, perMinute: clean(unused) });
    }
  }

  const edges = new Map<string, FlowEdge>();
  for (const [item, itemUsers] of users) {
    const itemSources = sources.get(item) ?? [];
    const made = total(itemSources);
    if (made <= NOISE) continue;
    for (const user of itemUsers) {
      for (const source of itemSources) {
        const perMinute = (user.perMinute * source.perMinute) / made;
        if (perMinute <= NOISE) continue;
        const id = `${source.node}>${user.node}|${item}`;
        const found = edges.get(id);
        if (found) found.perMinute = clean(found.perMinute + perMinute);
        else edges.set(id, { id, from: source.node, to: user.node, item, perMinute: clean(perMinute) });
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values(), ...unusedSupply] };
}

const total = (flows: Flow[] | undefined) => (flows ?? []).reduce((sum, flow) => sum + flow.perMinute, 0);

export interface Point {
  x: number;
  y: number;
}

export interface PlacedNode {
  node: FlowNode;
  /** Top left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedEdge {
  edge: FlowEdge;
  points: Point[];
  /** Halfway along the arrow, where its rate label goes. */
  label: Point;
  /** The arrow runs right to left: it closes a loop. */
  back: boolean;
}

export interface FlowLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

export interface FlowSizes {
  recipe: { width: number; height: number };
  end: { width: number; height: number };
  /** The room between two columns, enough for a rate label. */
  gap: number;
}

/**
 * Places the boxes in columns from left to right and routes the arrows between them. The rate
 * labels get no column of their own (that would double the width); each sits halfway along its arrow.
 */
export function layoutFlow(graph: FlowGraph, sizes: FlowSizes): FlowLayout {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 24, ranksep: sizes.gap, edgesep: 16, marginx: 8, marginy: 8 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of graph.nodes) g.setNode(node.id, { ...(node.kind === "recipe" ? sizes.recipe : sizes.end) });
  for (const edge of graph.edges) g.setEdge(edge.from, edge.to, {}, edge.id);
  dagre.layout(g);

  const centre = new Map<string, Point>();
  const nodes = graph.nodes.map((node) => {
    const placed = g.node(node.id);
    centre.set(node.id, { x: placed.x, y: placed.y });
    return { node, x: placed.x - placed.width / 2, y: placed.y - placed.height / 2, width: placed.width, height: placed.height };
  });
  const edges = graph.edges.map((edge) => {
    const placed = g.edge({ v: edge.from, w: edge.to, name: edge.id });
    const points = (placed.points ?? []).map((point: Point) => ({ x: point.x, y: point.y }));
    return { edge, points, label: halfway(points), back: centre.get(edge.from)!.x > centre.get(edge.to)!.x };
  });
  const size = g.graph();
  return { width: size.width ?? 0, height: size.height ?? 0, nodes, edges };
}

/** The point halfway along a line through `points`. */
export function halfway(points: Point[]): Point {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
  let left = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (const [index, length] of lengths.entries()) {
    if (left <= length && length > 0) {
      const from = points[index]!;
      const to = points[index + 1]!;
      return { x: from.x + ((to.x - from.x) * left) / length, y: from.y + ((to.y - from.y) * left) / length };
    }
    left -= length;
  }
  return points[0] ?? { x: 0, y: 0 };
}
