// Docking layouts as the main process stores them. The host UI owns the
// docking itself; the main process only checks what it is asked to save
// and keeps layouts in step with the panels that exist.
import type { LayoutGroup, LayoutNode, LayoutSplit, SavedLayout } from "../shared/host-api";
import { templateWeight as weight, type LayoutTemplate } from "../shared/layout-templates";
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
 * anything about it is malformed. Every panel may appear only once; a
 * group without panels is an empty slot. One group with panels may be maximized.
 */
export function parseLayout(raw: unknown): SavedLayout | null {
  if (!isObject(raw) || !only(raw, "width", "height", "direction", "root")) return null;
  if (!extent(raw.width) || !extent(raw.height)) return null;
  if (raw.direction !== "row" && raw.direction !== "column") return null;
  const seen = new Set<string>();
  let nodes = 0;
  let maximized = false;

  const node = (value: unknown, depth: number): LayoutNode | null => {
    if (++nodes > LAYOUT_LIMITS.nodes || depth > LAYOUT_LIMITS.depth || !isObject(value) || !extent(value.size)) return null;
    if (value.hidden !== undefined && value.hidden !== true) return null;
    const visibility = value.hidden ? { hidden: true as const } : {};
    if (value.kind === "split") {
      if (!only(value, "kind", "size", "children", "hidden") || !Array.isArray(value.children)) return null;
      const children: LayoutNode[] = [];
      for (const child of value.children) {
        const parsed = node(child, depth + 1);
        if (!parsed) return null;
        children.push(parsed);
      }
      return { kind: "split", size: value.size, ...visibility, children };
    }
    if (value.kind === "group") {
      if (!only(value, "kind", "size", "panels", "active", "hidden", "maximized") || !Array.isArray(value.panels)) return null;
      if (value.maximized !== undefined && (value.maximized !== true || value.panels.length === 0 || maximized)) return null;
      if (value.panels.length === 0) return value.active === null ? { kind: "group", size: value.size, ...visibility, panels: [], active: null } : null;
      for (const id of value.panels) {
        if (typeof id !== "string" || !INSTANCE_ID.test(id) || seen.has(id)) return null;
        seen.add(id);
      }
      if (seen.size > LAYOUT_LIMITS.panels) return null;
      if (typeof value.active !== "string" || !value.panels.includes(value.active)) return null;
      if (value.maximized) maximized = true;
      return { kind: "group", size: value.size, ...visibility, panels: [...(value.panels as string[])], active: value.active, ...(value.maximized ? { maximized: true } : {}) };
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
 * `rename` if given. Groups emptied by this go (empty slots stay), as do
 * splits left with nothing, and a split left with one child is merged into
 * its parent so directions still alternate. Returns null when nothing is left.
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
      if (node.panels.length === 0) return [{ ...node }];
      const panels = node.panels.filter(keep);
      if (panels.length === 0) return [];
      const active = node.active !== null && panels.includes(node.active) ? node.active : panels[0]!;
      return [{ ...node, panels: panels.map(rename), active: rename(active) }];
    }
    const children = node.children.flatMap(prune);
    if (children.length === 0) return [];
    if (children.length > 1) return [{ ...node, children }];
    const only = children[0]!;
    // A lone group takes the split's place. A lone split runs the same
    // direction as this split's parent, so its children join the parent.
    if (only.kind === "group") return [{ ...only, size: node.size, ...(node.hidden ? { hidden: true } : {}) }];
    return scale(only.children, node.size).map((child) => ({ ...child, ...(node.hidden ? { hidden: true as const } : {}) }));
  };

  const children = layout.root.children.flatMap(prune);
  if (children.length === 0) return null;
  // A root left with one split hands the root over to it, turned.
  const first = children[0]!;
  const reveal = (node: LayoutNode): LayoutNode => {
    const { hidden, ...visible } = node;
    return visible.kind === "split" ? { ...visible, children: visible.children.map(reveal) } : visible;
  };
  if (children.length === 1 && first.kind === "split") {
    return {
      width: layout.width,
      height: layout.height,
      direction: layout.direction === "row" ? "column" : "row",
      root: { kind: "split", size: layout.root.size, children: first.children.map(reveal) },
    };
  }
  const hasVisible = (node: LayoutNode): boolean => !node.hidden && (node.kind === "group" || node.children.some(hasVisible));
  const accessible = children.some(hasVisible) ? children : children.map(reveal);
  return { ...layout, root: { kind: "split", size: layout.root.size, children: accessible } };
}

/**
 * Takes panels out without changing the arrangement: a group that loses some panels keeps the
 * rest, and one that loses all of them stays as an empty slot, so the player sees where they were
 * (decision log, module grants row of 2026-10-16).
 */
export function vacateLayout(layout: SavedLayout | null, remove: (id: string) => boolean): SavedLayout | null {
  if (!layout) return null;
  const group = (node: LayoutGroup): LayoutGroup => {
    const panels = node.panels.filter((id) => !remove(id));
    if (panels.length === 0) return { kind: "group", size: node.size, ...(node.hidden ? { hidden: true } : {}), panels: [], active: null };
    const active = node.active !== null && panels.includes(node.active) ? node.active : panels[0]!;
    return { ...node, panels, active };
  };
  const split = (node: LayoutSplit): LayoutSplit => ({ ...node, children: node.children.map((child) => (child.kind === "split" ? split(child) : group(child))) });
  return { ...layout, root: split(layout.root) };
}

/** Scales sizes so they add up to `total`, keeping their proportions. */
function scale(nodes: LayoutNode[], total: number): LayoutNode[] {
  const sum = nodes.reduce((acc, node) => acc + node.size, 0);
  if (sum <= 0) return nodes.map((node) => ({ ...node, size: total / nodes.length }));
  return nodes.map((node) => ({ ...node, size: (node.size / sum) * total }));
}

/** The size a template layout is built at; restoring scales it to the area there is. */
const TEMPLATE_AREA = { width: 1200, height: 800 } as const;

/**
 * Builds a template's layout. `panels` fill its slots in order, one each;
 * any left over join the last slot as tabs. The other slots stay empty.
 */
export function templateLayout(template: LayoutTemplate, panels: readonly string[]): SavedLayout {
  const row = template.direction === "row";
  const along = row ? TEMPLATE_AREA.width : TEMPLATE_AREA.height;
  const across = row ? TEMPLATE_AREA.height : TEMPLATE_AREA.width;
  const total = template.parts.reduce<number>((sum, part) => sum + weight(part), 0);
  const slots: LayoutGroup[] = [];
  const slot = (size: number): LayoutGroup => {
    const group: LayoutGroup = { kind: "group", size, panels: [], active: null };
    slots.push(group);
    return group;
  };
  const children = template.parts.map((part): LayoutNode => {
    const size = (weight(part) / total) * along;
    if (typeof part === "number") return slot(size);
    const sum = weight(part);
    return { kind: "split", size, children: part.map((value) => slot((value / sum) * across)) };
  });
  panels.forEach((id, index) => {
    const group = slots[Math.min(index, slots.length - 1)]!;
    group.panels.push(id);
    group.active ??= id;
  });
  return { ...TEMPLATE_AREA, direction: template.direction, root: { kind: "split", size: across, children } };
}
