// Glue between Tavora's saved layouts and the docking library: converting
// layouts both ways, where new panels go, and which drops leave every panel
// at least its module's minimum size.
import {
  Orientation,
  type DockviewApi,
  type PanelTransfer,
  type Position,
  type DockviewGroupPanel,
  type DockviewWillDropEvent,
  type SerializedDockview,
} from "dockview-vue";
import type { HostViewState, LayoutNode, PanelView, SavedLayout } from "../shared/host-api";

/** Height of a group's tab bar; module content starts below it. */
export const TAB_HEIGHT = 36;
export const PANEL_COMPONENT = "panel";

type GridNode = SerializedDockview["grid"]["root"];
type GroupState = Exclude<GridNode["data"], GridNode[]>;

export interface PanelInfo {
  title: string;
  /** The module the panel belongs to, for its menu. */
  module?: { id: string; name: string };
  minWidth: number;
  minHeight: number;
}

/** Width of a panel card's border (dock.css), in px. */
const CARD_BORDER = 1;

/**
 * The room a panel needs when its module is not there: Discord or AI Usage before they are installed, or a
 * development module that can't load right now. Enough for the note and the button its slot shows.
 */
export const MISSING_MODULE_SIZE = { minWidth: 240, minHeight: 160 };

/** What docking needs to know about a panel: its title, and the room its module (or panel type) asks for. */
export function panelInfo(panel: PanelView | undefined, modules: readonly HostViewState["modules"][number][]): PanelInfo | undefined {
  if (!panel) return undefined;
  const module = modules.find((item) => item.id === panel.moduleId);
  // A panel type may need more (or less) room than its module.
  const size = module?.panels.find((type) => type.id === panel.panelType) ?? module ?? MISSING_MODULE_SIZE;
  // A panel card's 1 px border on each side comes out of the module's room.
  return {
    title: panel.name,
    minWidth: size.minWidth + 2 * CARD_BORDER,
    minHeight: size.minHeight + 2 * CARD_BORDER,
    ...(module ? { module: { id: module.id, name: module.name } } : {}),
  };
}

export function toDockview(layout: SavedLayout, info: (id: string) => PanelInfo | undefined): SerializedDockview {
  let groups = 0;
  const panels: SerializedDockview["panels"] = {};
  const node = (value: LayoutNode): GridNode => {
    const visibility = value.hidden ? { visible: false } : {};
    if (value.kind === "split") return { type: "branch", size: value.size, ...visibility, data: value.children.map(node) };
    for (const id of value.panels) panels[id] = { id, contentComponent: PANEL_COMPONENT, title: info(id)?.title ?? "" };
    return { type: "leaf", size: value.size, ...visibility, data: { id: `group-${++groups}`, views: value.panels, activeView: value.active ?? undefined } };
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

/**
 * Reads the docked part of a layout, empty slots included; null when nothing is docked. `maximized` is a panel
 * of the group that fills the workspace, if one does.
 */
export function fromDockview(json: SerializedDockview, maximized: string | null = null): SavedLayout | null {
  const node = (value: GridNode): LayoutNode | null => {
    const visibility = value.visible === false ? { hidden: true as const } : {};
    if (value.type === "branch") {
      const children = (value.data as GridNode[]).map(node).filter((child) => child !== null);
      return children.length ? { kind: "split", size: value.size ?? 0, ...visibility, children } : null;
    }
    const group = value.data as GroupState;
    if (!group.views.length) return { kind: "group", size: value.size ?? 0, ...visibility, panels: [], active: null };
    const active = group.activeView && group.views.includes(group.activeView) ? group.activeView : group.views[0]!;
    return { kind: "group", size: value.size ?? 0, ...visibility, panels: [...group.views], active, ...(maximized && group.views.includes(maximized) ? { maximized: true } : {}) };
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

/** A panel of the layout's maximized group, or null when no group fills the workspace. */
export function maximizedPanel(layout: SavedLayout | null): string | null {
  const find = (node: LayoutNode): string | null =>
    node.kind === "group" ? (node.maximized ? (node.active ?? node.panels[0] ?? null) : null) : node.children.reduce<string | null>((found, child) => found ?? find(child), null);
  return layout ? find(layout.root) : null;
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
 * Docks a new panel: into an empty slot if there is one (`slot` if it is
 * still empty, else the active group's, else the first), else beside the
 * active group if its row has room for everyone's minimum width, else below
 * it, else beside or below the roomiest other group, else as a tab in the
 * active group. The row or column it joins is then shared out evenly.
 */
export function placePanel(api: DockviewApi, id: string, info: Info, slot?: string | null): void {
  const panel = info(id)!;
  const base = { id, component: PANEL_COMPONENT, title: panel.title };
  const active = api.activeGroup ?? api.groups[0];
  if (!active) {
    api.addPanel(base);
    return;
  }
  const empty = [slot ? api.getGroup(slot) : undefined, active, ...api.groups].find((group) => group && group.panels.length === 0);
  if (empty) {
    api.addPanel({ ...base, position: { referenceGroup: empty.id, direction: "within" } });
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

/**
 * Docks a new Browser tab right after the tab it was opened from, in the same
 * group. A background tab (a middle-click) does not take focus. Returns false
 * when the source panel is gone, so the caller places it as usual.
 */
export function placeTab(api: DockviewApi, id: string, info: Info, from: string, background: boolean): boolean {
  const source = api.getPanel(from);
  if (!source) return false;
  const index = source.group.panels.indexOf(source) + 1;
  api.addPanel({
    id,
    component: PANEL_COMPONENT,
    title: info(id)?.title,
    position: { referencePanel: source, direction: "within", index },
    inactive: background,
  });
  return true;
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
 * Whether dropping what is dragged (`data`) at `position` of `target` (null
 * for the dock's outer edge) leaves every panel at least its minimum size.
 * Dropping onto the middle (as a tab) is always fine.
 */
export function dropAllowed(
  api: DockviewApi,
  info: Info,
  data: PanelTransfer | undefined,
  target: DockviewGroupPanel | undefined,
  position: Position,
): boolean {
  if (!data || position === "center") return true;
  const source = api.getGroup(data.groupId) as DockviewGroupPanel | undefined;
  const dragged = data.panelId
    ? { width: info(data.panelId)?.minWidth ?? 0, height: (info(data.panelId)?.minHeight ?? 0) + TAB_HEIGHT }
    : source
      ? groupMinimum(source, info)
      : { width: 0, height: 0 };
  const sideways = position === "left" || position === "right";
  if (!target) {
    // An outer edge: the new column or row needs room next to everything else.
    return sideways ? api.width - api.minimumWidth >= dragged.width : api.height - api.minimumHeight >= dragged.height;
  }
  // Moving a group's only panel to its own edge changes nothing.
  if (target === source && target.panels.length === 1) return true;
  const leaving = source && (!data.panelId || source.panels.length === 1) ? source.id : undefined;
  return fits(api, target, sideways ? "right" : "below", dragged, info, leaving);
}

/** A group's place on screen, as getBoundingClientRect gives it. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Whether a drop beside a group only changes the order: the dragged panel leaves a group of its
 * own in the target's row (left, right) or column (top, bottom), so the groups swap places and
 * keep their sizes. The preview then shows a bar where it lands instead of half of the target.
 */
export function dropReorders(source: Box | undefined, alone: boolean, target: Box, position: Position): boolean {
  if (!source || !alone || position === "center") return false;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  return position === "left" || position === "right"
    ? near(source.y, target.y) && near(source.height, target.height)
    : near(source.x, target.x) && near(source.width, target.width);
}

/** Refuses drops that would split a group too small for its panels or the one dropped. */
export function guardDrop(event: DockviewWillDropEvent, api: DockviewApi, info: Info): void {
  if (!dropAllowed(api, info, event.getData(), event.group, event.position)) event.preventDefault();
}

// ── The drop guide ─────────────────────────────────────────────────────

/** The drop guide: five cells in a cross at the centre of the group under the pointer. */
export const GUIDE = { cell: 40, gap: 6 } as const;
const GUIDE_SPAN = 3 * GUIDE.cell + 2 * GUIDE.gap;
/** Each cell's place in the cross, in cells from the centre. */
export const GUIDE_CELLS: readonly { position: Position; dx: number; dy: number }[] = [
  { position: "top", dx: 0, dy: -1 },
  { position: "left", dx: -1, dy: 0 },
  { position: "center", dx: 0, dy: 0 },
  { position: "right", dx: 1, dy: 0 },
  { position: "bottom", dx: 0, dy: 1 },
];
/** Outside the guide, how close to an edge (as a share of the area) still drops there. */
const EDGE_BAND = 0.25;
/** The dock's outer edges take a drop this close to them, as dockview does by default. */
const OUTER_EDGE = 10;

/** Whether an area has room for the guide. */
export function guideFits(width: number, height: number): boolean {
  return width >= GUIDE_SPAN + 16 && height >= GUIDE_SPAN + 16;
}

/**
 * Where a drop at (x, y) in a group's `width` by `height` content goes: the
 * guide cell under the pointer, else the nearest edge when it is close, else
 * the middle (as a tab). Only `zones` are offered.
 */
export function resolveDropPosition(x: number, y: number, width: number, height: number, zones: ReadonlySet<Position>): Position | null {
  if (guideFits(width, height)) {
    const step = GUIDE.cell + GUIDE.gap;
    for (const { position, dx, dy } of GUIDE_CELLS) {
      const inside = Math.abs(x - (width / 2 + dx * step)) <= GUIDE.cell / 2 && Math.abs(y - (height / 2 + dy * step)) <= GUIDE.cell / 2;
      if (inside && zones.has(position)) return position;
    }
  }
  const edges = (
    [
      ["left", x / width],
      ["right", 1 - x / width],
      ["top", y / height],
      ["bottom", 1 - y / height],
    ] as const
  ).filter(([position]) => zones.has(position));
  const nearest = edges.reduce<(typeof edges)[number] | null>((best, edge) => (!best || edge[1] < best[1] ? edge : best), null);
  if (nearest && nearest[1] < EDGE_BAND) return nearest[0];
  return zones.has("center") ? "center" : null;
}

/** The dock's outer edges: a thin band along each, as dockview has by default. */
export function resolveOuterEdge(x: number, y: number, width: number, height: number, zones: ReadonlySet<Position>): Position | null {
  if (zones.has("left") && x < OUTER_EDGE) return "left";
  if (zones.has("right") && x > width - OUTER_EDGE) return "right";
  if (zones.has("top") && y < OUTER_EDGE) return "top";
  if (zones.has("bottom") && y > height - OUTER_EDGE) return "bottom";
  return zones.has("center") ? "center" : null;
}
