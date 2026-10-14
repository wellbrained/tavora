// Glue between Tavora's saved layouts and the docking library: converting
// layouts both ways, where new panels go, and which drops leave every panel
// at least its module's minimum size.
import {
  Orientation,
  type DockviewApi,
  type DockviewGroupPanel,
  type DockviewWillDropEvent,
  type SerializedDockview,
} from "dockview-vue";
import type { LayoutNode, SavedLayout } from "../shared/host-api";

/** Height of a group's tab bar; module content starts below it. */
export const TAB_HEIGHT = 36;
export const PANEL_COMPONENT = "panel";

type GridNode = SerializedDockview["grid"]["root"];
type GroupState = Exclude<GridNode["data"], GridNode[]>;

export interface PanelInfo {
  title: string;
  minWidth: number;
  minHeight: number;
}

export function toDockview(layout: SavedLayout, info: (id: string) => PanelInfo | undefined): SerializedDockview {
  let groups = 0;
  const panels: SerializedDockview["panels"] = {};
  const node = (value: LayoutNode): GridNode => {
    if (value.kind === "split") return { type: "branch", size: value.size, data: value.children.map(node) };
    for (const id of value.panels) panels[id] = { id, contentComponent: PANEL_COMPONENT, title: info(id)?.title ?? "" };
    return { type: "leaf", size: value.size, data: { id: `group-${++groups}`, views: value.panels, activeView: value.active } };
  };
  const row = layout.direction === "row";
  return {
    grid: {
      root: { ...node(layout.root), size: row ? layout.height : layout.width },
      width: layout.width,
      height: layout.height,
      orientation: row ? Orientation.HORIZONTAL : Orientation.VERTICAL,
    },
    panels,
  };
}

/** Reads the docked part of a layout; null when nothing is docked. */
export function fromDockview(json: SerializedDockview): SavedLayout | null {
  const node = (value: GridNode): LayoutNode | null => {
    if (value.type === "branch") {
      const children = (value.data as GridNode[]).map(node).filter((child) => child !== null);
      return children.length ? { kind: "split", size: value.size ?? 0, children } : null;
    }
    const group = value.data as GroupState;
    if (!group.views.length) return null;
    const active = group.activeView && group.views.includes(group.activeView) ? group.activeView : group.views[0]!;
    return { kind: "group", size: value.size ?? 0, panels: [...group.views], active };
  };
  const root = node(json.grid.root);
  if (!root) return null;
  return {
    width: Math.round(json.grid.width),
    height: Math.round(json.grid.height),
    direction: json.grid.orientation === Orientation.HORIZONTAL ? "row" : "column",
    root: root.kind === "split" ? root : { kind: "split", size: 0, children: [root] },
  };
}

/** The smallest size a group can have: room for each of its panels. */
export function groupMinimum(group: DockviewGroupPanel, info: (id: string) => PanelInfo | undefined) {
  let width = 0;
  let height = 0;
  for (const panel of group.panels) {
    const min = info(panel.id);
    width = Math.max(width, min?.minWidth ?? 0);
    height = Math.max(height, min?.minHeight ?? 0);
  }
  return { width, height: height + TAB_HEIGHT };
}

type Side = "right" | "below";
type Info = (id: string) => PanelInfo | undefined;

/** A group's minimum along one axis; its tab bar counts towards height. */
function leafMinimum(views: string[], horizontal: boolean, info: Info) {
  let min = 0;
  for (const id of views) min = Math.max(min, (horizontal ? info(id)?.minWidth : info(id)?.minHeight) ?? 0);
  return horizontal ? min : min + TAB_HEIGHT;
}

/** A node's minimum along one axis: children side by side add up, stacked ones take the largest. */
function nodeMinimum(node: GridNode, along: Orientation, horizontal: boolean, info: Info): number {
  if (node.type === "leaf") return leafMinimum((node.data as GroupState).views, horizontal, info);
  const children = (node.data as GridNode[]).map((child) => nodeMinimum(child, flip(along), horizontal, info));
  const sideBySide = (along === Orientation.HORIZONTAL) === horizontal;
  return sideBySide ? children.reduce((sum, value) => sum + value, 0) : Math.max(0, ...children);
}

const flip = (orientation: Orientation) =>
  orientation === Orientation.HORIZONTAL ? Orientation.VERTICAL : Orientation.HORIZONTAL;

interface Line {
  /** Room along the split axis that the line's members share. */
  total: number;
  /** Each member's minimum along that axis, in order. */
  mins: number[];
  /** The member groups (null for a nested split), in order. */
  members: (string | null)[];
  /** Where the reference group sits among the members. */
  index: number;
}

/**
 * The row (for "right") or column (for "below") a new panel beside `group`
 * would join: the group's siblings when its split runs that way, else just
 * the group, which dockview then splits in two.
 */
function lineOf(api: DockviewApi, group: DockviewGroupPanel, side: Side, info: Info): Line {
  const horizontal = side === "right";
  const own = { total: horizontal ? group.width : group.height, mins: [leafMinimum(group.panels.map((panel) => panel.id), horizontal, info)], members: [group.id], index: 0 };
  const json = api.toJSON();
  const find = (node: GridNode, along: Orientation): Line | null => {
    if (node.type === "leaf") return null;
    const children = node.data as GridNode[];
    const index = children.findIndex((child) => child.type === "leaf" && (child.data as GroupState).id === group.id);
    if (index >= 0) {
      if ((along === Orientation.HORIZONTAL) !== horizontal) return own;
      const mins = children.map((child) => nodeMinimum(child, flip(along), horizontal, info));
      const members = children.map((child) => (child.type === "leaf" ? (child.data as GroupState).id : null));
      // Sizes are not always reported, so the line's room is measured from the group.
      const total = children.reduce((sum, child) => sum + (child.size ?? 0), 0) || own.total;
      return { total, mins, members, index };
    }
    for (const child of children) {
      const found = find(child, flip(along));
      if (found) return found;
    }
    return null;
  };
  return find(json.grid.root, json.grid.orientation) ?? own;
}

/** Shares `total` evenly, but never below a member's minimum. */
export function shareOut(total: number, mins: number[]): number[] {
  const sizes = mins.map(() => 0);
  let left = new Set(mins.keys());
  let room = total;
  for (;;) {
    const each = room / left.size;
    const tight = [...left].filter((i) => mins[i]! > each);
    if (!tight.length) {
      for (const i of left) sizes[i] = each;
      return sizes;
    }
    for (const i of tight) {
      sizes[i] = mins[i]!;
      room -= mins[i]!;
      left.delete(i);
    }
    if (!left.size) return sizes;
  }
}

/**
 * Docks a new panel: beside the active group if its row has room for
 * everyone's minimum width, else below it, else beside or below the
 * roomiest other group, else as a tab in the active group. The row or
 * column it joins is then shared out evenly.
 */
export function placePanel(api: DockviewApi, id: string, info: Info): void {
  const panel = info(id)!;
  const base = { id, component: PANEL_COMPONENT, title: panel.title };
  const active = api.activeGroup ?? api.groups[0];
  if (!active) {
    api.addPanel(base);
    return;
  }
  const others = api.groups.filter((group) => group !== active).sort((a, b) => b.width * b.height - a.width * a.height);
  for (const group of [active, ...others]) {
    for (const side of ["right", "below"] as const) {
      const horizontal = side === "right";
      const line = lineOf(api, group, side, info);
      const min = horizontal ? panel.minWidth : panel.minHeight + TAB_HEIGHT;
      const across = horizontal ? group.height >= panel.minHeight + TAB_HEIGHT : group.width >= panel.minWidth;
      const needed = line.mins.reduce((sum, value) => sum + value, min);
      if (!across || needed > line.total) continue;
      const added = api.addPanel({ ...base, position: { referenceGroup: group, direction: side } });
      const fresh = added.group;
      const minimum = groupMinimum(fresh, info);
      fresh.api.setConstraints({ minimumWidth: minimum.width, minimumHeight: minimum.height });
      const members = [...line.members];
      const mins = [...line.mins];
      members.splice(line.index + 1, 0, fresh.id);
      mins.splice(line.index + 1, 0, min);
      const sizes = shareOut(line.total, mins);
      members.forEach((member, i) => {
        const target = member ? api.getGroup(member) : undefined;
        target?.api.setSize(horizontal ? { width: sizes[i]! } : { height: sizes[i]! });
      });
      return;
    }
  }
  api.addPanel({ ...base, position: { referenceGroup: active, direction: "within" } });
}

/** Whether the row or column beside `group` has room for one more of size `min`. */
function fits(
  api: DockviewApi,
  group: DockviewGroupPanel,
  side: Side,
  min: { width: number; height: number },
  info: Info,
  leaving?: string,
) {
  const horizontal = side === "right";
  const line = lineOf(api, group, side, info);
  const across = horizontal ? group.height >= min.height : group.width >= min.width;
  // A group that empties by the move gives its room back to the line.
  const mins = line.mins.filter((_, i) => !leaving || line.members[i] !== leaving);
  return across && mins.reduce((sum, value) => sum + value, horizontal ? min.width : min.height) <= line.total;
}

/**
 * Refuses drops that would split a group too small for its panels or the
 * one dropped. Dropping onto the middle (as a tab) is always fine.
 */
export function guardDrop(event: DockviewWillDropEvent, api: DockviewApi, info: (id: string) => PanelInfo | undefined): void {
  const data = event.getData();
  if (!data || event.position === "center") return;
  const source = api.getGroup(data.groupId) as DockviewGroupPanel | undefined;
  const dragged = data.panelId
    ? { width: info(data.panelId)?.minWidth ?? 0, height: (info(data.panelId)?.minHeight ?? 0) + TAB_HEIGHT }
    : source
      ? groupMinimum(source, info)
      : { width: 0, height: 0 };
  const sideways = event.position === "left" || event.position === "right";
  const target = event.group;
  if (!target) {
    // An outer edge: the new column or row needs room next to everything else.
    const ok = sideways ? api.width - api.minimumWidth >= dragged.width : api.height - api.minimumHeight >= dragged.height;
    if (!ok) event.preventDefault();
    return;
  }
  // Moving a group's only panel to its own edge changes nothing.
  if (target === source && target.panels.length === 1) return;
  const leaving = source && (!data.panelId || source.panels.length === 1) ? source.id : undefined;
  if (!fits(api, target, sideways ? "right" : "below", dragged, info, leaving)) event.preventDefault();
}
