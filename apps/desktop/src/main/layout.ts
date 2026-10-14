// Docking layouts as the main process stores them. The host UI owns the
// docking itself; the main process only checks what it is asked to save
// and keeps layouts in step with the panels that exist.
import type { LayoutNode, SavedLayout } from "../shared/host-api";
import { INSTANCE_ID } from "./ids";

export type { LayoutGroup, LayoutNode, LayoutSplit, SavedLayout } from "../shared/host-api";

/** Limits for a saved layout; far beyond what fits on a screen. */
export const LAYOUT_LIMITS = { depth: 12, nodes: 400, panels: 200, extent: 100_000 } as const;

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const extent = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= LAYOUT_LIMITS.extent;
const only = (value: Fields, ...keys: string[]) => Object.keys(value).every((key) => keys.includes(key));

/**
 * Checks a layout sent by the host UI and returns a clean copy, or null if
 * anything about it is malformed. Every panel may appear only once.
 */
export function parseLayout(raw: unknown): SavedLayout | null {
  if (!isObject(raw) || !only(raw, "width", "height", "direction", "root")) return null;
  if (!extent(raw.width) || !extent(raw.height)) return null;
  if (raw.direction !== "row" && raw.direction !== "column") return null;
  const seen = new Set<string>();
  let nodes = 0;

  const node = (value: unknown, depth: number): LayoutNode | null => {
    if (++nodes > LAYOUT_LIMITS.nodes || depth > LAYOUT_LIMITS.depth || !isObject(value) || !extent(value.size)) return null;
    if (value.kind === "split") {
      if (!only(value, "kind", "size", "children") || !Array.isArray(value.children)) return null;
      const children: LayoutNode[] = [];
      for (const child of value.children) {
        const parsed = node(child, depth + 1);
        if (!parsed) return null;
        children.push(parsed);
      }
      return { kind: "split", size: value.size, children };
    }
    if (value.kind === "group") {
      if (!only(value, "kind", "size", "panels", "active") || !Array.isArray(value.panels) || value.panels.length === 0) return null;
      for (const id of value.panels) {
        if (typeof id !== "string" || !INSTANCE_ID.test(id) || seen.has(id)) return null;
        seen.add(id);
      }
      if (seen.size > LAYOUT_LIMITS.panels) return null;
      if (typeof value.active !== "string" || !value.panels.includes(value.active)) return null;
      return { kind: "group", size: value.size, panels: [...(value.panels as string[])], active: value.active };
    }
    return null;
  };

  const root = node(raw.root, 0);
  if (!root || root.kind !== "split") return null;
  return { width: raw.width, height: raw.height, direction: raw.direction, root };
}

/** All panel ids in the layout, in tree order. */
export function layoutPanels(layout: SavedLayout | null): string[] {
  const ids: string[] = [];
  const walk = (node: LayoutNode) => {
    if (node.kind === "group") ids.push(...node.panels);
    else node.children.forEach(walk);
  };
  if (layout) walk(layout.root);
  return ids;
}

/**
 * Keeps only panels for which `keep` is true, renaming them through
 * `rename` if given. Empty groups and splits go, and a split left with one
 * child is merged into its parent so directions still alternate. Returns
 * null when no panel is left.
 */
export function pruneLayout(
  layout: SavedLayout | null,
  keep: (id: string) => boolean,
  rename: (id: string) => string = (id) => id,
): SavedLayout | null {
  if (!layout) return null;

  // Returns the nodes that take this node's place in its parent.
  const prune = (node: LayoutNode): LayoutNode[] => {
    if (node.kind === "group") {
      const panels = node.panels.filter(keep);
      if (panels.length === 0) return [];
      const active = panels.includes(node.active) ? node.active : panels[0]!;
      return [{ kind: "group", size: node.size, panels: panels.map(rename), active: rename(active) }];
    }
    const children = node.children.flatMap(prune);
    if (children.length === 0) return [];
    if (children.length > 1) return [{ kind: "split", size: node.size, children }];
    const only = children[0]!;
    // A lone group takes the split's place. A lone split runs the same
    // direction as this split's parent, so its children join the parent.
    if (only.kind === "group") return [{ ...only, size: node.size }];
    return scale(only.children, node.size);
  };

  const children = layout.root.children.flatMap(prune);
  if (children.length === 0) return null;
  // A root left with one split hands the root over to it, turned.
  const first = children[0]!;
  if (children.length === 1 && first.kind === "split") {
    return {
      width: layout.width,
      height: layout.height,
      direction: layout.direction === "row" ? "column" : "row",
      root: { kind: "split", size: layout.root.size, children: first.children },
    };
  }
  return { ...layout, root: { kind: "split", size: layout.root.size, children } };
}

/** Scales sizes so they add up to `total`, keeping their proportions. */
function scale(nodes: LayoutNode[], total: number): LayoutNode[] {
  const sum = nodes.reduce((acc, node) => acc + node.size, 0);
  if (sum <= 0) return nodes.map((node) => ({ ...node, size: total / nodes.length }));
  return nodes.map((node) => ({ ...node, size: (node.size / sum) * total }));
}
