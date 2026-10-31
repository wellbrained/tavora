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
import type { HostViewState, LayoutGroup, LayoutNode, LayoutSplit, PanelView, SavedLayout } from "../shared/host-api";
import { fitSlots, slotPanels, type Slots } from "../shared/panel-layout";

/** Height of a group's tab bar; module content starts below it. */
export const TAB_HEIGHT = 36;
export const PANEL_COMPONENT = "panel";

type GridNode = SerializedDockview["grid"]["root"];
type GroupState = Exclude<GridNode["data"], GridNode[]>;

/**
 * The room a panel asks for: one minimum, or with `wide` one while it is taller than wide (or square) and
 * one while it is wider than tall. Heights here never count the tab bar.
 */
export interface Sizes {
  minWidth: number;
  minHeight: number;
  wide?: { minWidth: number; minHeight: number };
}

export interface PanelInfo extends Sizes {
  title: string;
  /** The module the panel belongs to, for its menu. */
  module?: { id: string; name: string };
}

/** Width of a panel card's border (dock.css), in px. */
const CARD_BORDER = 1;

/**
 * The room a panel needs when its module is not there: Discord or AI Usage before they are installed, or a
 * development module that can't load right now. Enough for the note and the button its slot shows.
 */
export const MISSING_MODULE_SIZE: Sizes = { minWidth: 240, minHeight: 160 };

/** What docking needs to know about a panel: its title, and the room its module (or panel type) asks for. */
export function panelInfo(panel: PanelView | undefined, modules: readonly HostViewState["modules"][number][]): PanelInfo | undefined {
  if (!panel) return undefined;
  const module = modules.find((item) => item.id === panel.moduleId);
  // A panel type may need more (or less) room than its module.
  const size: Sizes = module?.panels.find((type) => type.id === panel.panelType) ?? module ?? MISSING_MODULE_SIZE;
  // A panel card's 1 px border on each side comes out of the module's room.
  const border = 2 * CARD_BORDER;
  return {
    title: panel.name,
    minWidth: size.minWidth + border,
    minHeight: size.minHeight + border,
    ...(size.wide ? { wide: { minWidth: size.wide.minWidth + border, minHeight: size.wide.minHeight + border } } : {}),
    ...(module ? { module: { id: module.id, name: module.name } } : {}),
  };
}

// ── Tall and wide ──────────────────────────────────────────────────────
//
// A module may have a layout for panels wider than tall, with its own minimum. The sizes it allows are then no
// longer one rectangle, so docking asks along one side at a time: a drag changes only one side of a panel, and
// its size along the other tells which stretch is allowed.

/** Sizes along one side of a panel that its module allows, in px; `max` is Infinity when there is no end. */
export interface Span {
  min: number;
  max: number;
}

/** Sorts spans and joins those that touch; sizes need not be whole pixels, so one pixel apart touches. */
function join(spans: Span[]): Span[] {
  const joined: Span[] = [];
  for (const span of spans.filter((item) => item.min <= item.max).sort((a, b) => a.min - b.min)) {
    const last = joined.at(-1);
    if (last && span.min <= last.max + 1) last.max = Math.max(last.max, span.max);
    else joined.push({ ...span });
  }
  return joined;
}

/**
 * The widths a panel allows while it is `height` tall; none when that is too short. With a wide layout: up to square for the tall one and
 * beyond square for the wide one, each only where its minimum fits. Where the two don't touch, a drag stops at
 * the square instead of going on into a layout too small.
 */
export function widthSpans(panel: Sizes, height: number): Span[] {
  const { wide } = panel;
  if (!wide) return height >= panel.minHeight ? [{ min: panel.minWidth, max: Infinity }] : [];
  const spans: Span[] = [];
  if (height >= panel.minHeight) spans.push({ min: panel.minWidth, max: height });
  if (height >= wide.minHeight) spans.push({ min: Math.max(wide.minWidth, height + 1), max: Infinity });
  return join(spans);
}

/** The heights a panel allows while it is `width` wide: the same rule as widthSpans, turned. */
export function heightSpans(panel: Sizes, width: number): Span[] {
  const { wide } = panel;
  if (!wide) return width >= panel.minWidth ? [{ min: panel.minHeight, max: Infinity }] : [];
  const spans: Span[] = [];
  if (width >= wide.minWidth) spans.push({ min: wide.minHeight, max: width - 1 });
  if (width >= panel.minWidth) spans.push({ min: Math.max(panel.minHeight, width), max: Infinity });
  return join(spans);
}

/** What all of `lists` allow: the overlap of one span from each. */
function overlap(lists: Span[][]): Span[] {
  return lists.reduce<Span[]>(
    (all, spans) => join(all.flatMap((a) => spans.map((b) => ({ min: Math.max(a.min, b.min), max: Math.min(a.max, b.max) })))),
    [{ min: 0, max: Infinity }],
  );
}

/** The smallest size along one side that some layout of the panel allows, whatever the other side is. */
function loosest(panel: Sizes, horizontal: boolean): number {
  const own = horizontal ? panel.minWidth : panel.minHeight;
  if (!panel.wide) return own;
  return Math.min(own, horizontal ? panel.wide.minWidth : panel.wide.minHeight);
}

/**
 * The least room along one side (width when `horizontal`) that panels `ids` all allow while they are `across`
 * along the other; Infinity when they allow nothing there. Heights count the tab bar, both `across` and the result.
 */
export function leastAlong(ids: readonly string[], horizontal: boolean, across: number, info: Info): number {
  const sizes = ids.map(info).filter((item) => item !== undefined);
  const spans = overlap(sizes.map((panel) => (horizontal ? widthSpans(panel, across - TAB_HEIGHT) : heightSpans(panel, across))));
  const least = spans[0]?.min ?? Infinity;
  return horizontal ? least : least + TAB_HEIGHT;
}

/** The sizes a group may be dragged to, as dockview takes them. */
export interface Constraints {
  minimumWidth: number;
  maximumWidth: number;
  minimumHeight: number;
  maximumHeight: number;
}

/** A group's size and panels: enough of a dockview group to work out its constraints. */
export interface GroupShape {
  width: number;
  height: number;
  panels: readonly { id: string }[];
}

/**
 * The sizes a group may be dragged to from where it is: along each side, the stretch its panels all allow at
 * its size along the other that holds the current size (else the nearest one). A size no layout allows, as
 * before the first layout, falls back to the smallest each side could ever be.
 */
export function groupConstraints(group: GroupShape, info: Info): Constraints {
  const sizes = group.panels.map((panel) => info(panel.id)).filter((item) => item !== undefined);
  const height = group.height - TAB_HEIGHT;
  const nearest = (spans: Span[], size: number, horizontal: boolean): Span => {
    const away = (span: Span) => Math.max(0, span.min - size, size - span.max);
    const best = spans.reduce<Span | null>((found, span) => (!found || away(span) < away(found) ? span : found), null);
    return best ?? { min: Math.max(0, ...sizes.map((panel) => loosest(panel, horizontal))), max: Infinity };
  };
  const width = nearest(overlap(sizes.map((panel) => widthSpans(panel, height))), group.width, true);
  const tall = nearest(overlap(sizes.map((panel) => heightSpans(panel, group.width))), height, false);
  const end = (max: number) => (max === Infinity ? Number.MAX_SAFE_INTEGER : max);
  return { minimumWidth: width.min, maximumWidth: end(width.max), minimumHeight: tall.min + TAB_HEIGHT, maximumHeight: end(tall.max + TAB_HEIGHT) };
}

export function toDockview(layout: SavedLayout, info: (id: string) => PanelInfo | undefined): SerializedDockview {
  let groups = 0;
  let focused: string | undefined;
  const panels: SerializedDockview["panels"] = {};
  const node = (value: LayoutNode): GridNode => {
    const visibility = value.hidden ? { visible: false } : {};
    if (value.kind === "split") return { type: "branch", size: value.size, ...visibility, data: value.children.map(node) };
    for (const id of value.panels) panels[id] = { id, contentComponent: PANEL_COMPONENT, title: info(id)?.title ?? "" };
    const id = `group-${++groups}`;
    if (value.focused) focused = id;
    return { type: "leaf", size: value.size, ...visibility, data: { id, views: value.panels, activeView: value.active ?? undefined } };
  };
  const row = layout.direction === "row";
  const root = { ...node(layout.root), size: row ? layout.height : layout.width };
  return {
    grid: {
      root,
      width: layout.width,
      height: layout.height,
      orientation: row ? Orientation.HORIZONTAL : Orientation.VERTICAL,
    },
    panels,
    ...(focused ? { activeGroup: focused } : {}),
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
    const focused = json.activeGroup === group.id ? { focused: true as const } : {};
    if (!group.views.length) return { kind: "group", size: value.size ?? 0, ...visibility, panels: [], active: null, ...focused };
    const active = group.activeView && group.views.includes(group.activeView) ? group.activeView : group.views[0]!;
    return { kind: "group", size: value.size ?? 0, ...visibility, panels: [...group.views], active, ...(maximized && group.views.includes(maximized) ? { maximized: true } : {}), ...focused };
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

type Side = "right" | "below";
type Info = (id: string) => PanelInfo | undefined;

/** A group's minimum along one axis at its size along the other; its tab bar counts towards height. */
function leafMinimum(api: DockviewApi, id: string, views: string[], horizontal: boolean, info: Info) {
  if (!views.length) return horizontal ? 0 : TAB_HEIGHT;
  const group = api.getGroup(id);
  const least = group ? leastAlong(views, horizontal, horizontal ? group.height : group.width, info) : Infinity;
  if (least !== Infinity) return least;
  // A group not laid out yet, or one no layout fits right now: the smallest it could ever be.
  const min = Math.max(0, ...views.map((view) => info(view)).filter((item) => item !== undefined).map((panel) => loosest(panel, horizontal)));
  return horizontal ? min : min + TAB_HEIGHT;
}

/** A node's minimum along one axis: children side by side add up, stacked ones take the largest. */
function nodeMinimum(api: DockviewApi, node: GridNode, along: Orientation, horizontal: boolean, info: Info): number {
  if (node.type === "leaf") {
    const group = node.data as GroupState;
    return leafMinimum(api, group.id, group.views, horizontal, info);
  }
  const children = (node.data as GridNode[]).map((child) => nodeMinimum(api, child, flip(along), horizontal, info));
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
  const own = { total: horizontal ? group.width : group.height, mins: [leafMinimum(api, group.id, group.panels.map((panel) => panel.id), horizontal, info)], members: [group.id], index: 0 };
  const json = api.toJSON();
  const find = (node: GridNode, along: Orientation): Line | null => {
    if (node.type === "leaf") return null;
    const children = node.data as GridNode[];
    const index = children.findIndex((child) => child.type === "leaf" && (child.data as GroupState).id === group.id);
    if (index >= 0) {
      if ((along === Orientation.HORIZONTAL) !== horizontal) return own;
      const mins = children.map((child) => nodeMinimum(api, child, flip(along), horizontal, info));
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

/**
 * Docks a new panel where the user is working, without moving anything else: into an empty slot if there is
 * one (`slot` if it is still empty, else the active group's, else the first), else as a tab in the active
 * group (after a restart the one the user last worked in, else the biggest). A group too small for the new
 * panel then grows only as far as its constraints make it.
 */
export function placePanel(api: DockviewApi, id: string, info: Info, slot?: string | null): void {
  const base = { id, component: PANEL_COMPONENT, title: info(id)?.title ?? "" };
  const empty = [slot ? api.getGroup(slot) : undefined, api.activeGroup, ...api.groups].find((group) => group && group.panels.length === 0);
  const target = empty ?? api.activeGroup ?? [...api.groups].sort((a, b) => b.width * b.height - a.width * a.height)[0];
  api.addPanel(target ? { ...base, position: { referenceGroup: target.id, direction: "within" } } : base);
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

/** Whether every one of panels `ids` has room in a group of `width` by `height` (the tab bar counted in). */
export function roomFor(ids: readonly string[], width: number, height: number, info: Info): boolean {
  return ids.every((id) => {
    const panel = info(id);
    return !panel || widthSpans(panel, height - TAB_HEIGHT).some((span) => width >= span.min && width <= span.max);
  });
}

/**
 * Lays out panels opened together (panels.openMany) inside the group of `anchor`, as `slots` (the module's panelLayout,
 * by instance id) says: the anchor's group, with its other tabs, keeps the anchor's slot, and the new panels split off
 * around it, in the layout's sizes measured against that group. Nothing outside the group moves. A new panel whose slot
 * would be too small for it (fitSlots) becomes a tab of the anchor's group instead. Answers the new layout and the panels
 * it placed, or null when the anchor is not docked.
 */
export function layoutAround(layout: SavedLayout, anchor: string, slots: Slots, info: Info): { layout: SavedLayout; placed: string[] } | null {
  const next = structuredClone(layout);
  type Found = { parent: LayoutSplit; index: number; direction: "row" | "column"; width: number; height: number };
  const find = (split: LayoutSplit, direction: "row" | "column", width: number, height: number): Found | null => {
    const shown = split.children.filter((child) => !child.hidden);
    const total = shown.reduce((sum, child) => sum + child.size, 0);
    const row = direction === "row";
    for (const [index, child] of split.children.entries()) {
      if (child.hidden) continue;
      const share = total > 0 ? child.size / total : 1 / shown.length;
      const [w, h] = row ? [width * share, height] : [width, height * share];
      if (child.kind === "group" && child.panels.includes(anchor)) return { parent: split, index, direction, width: w, height: h };
      if (child.kind === "split") {
        const found = find(child, row ? "column" : "row", w, h);
        if (found) return found;
      }
    }
    return null;
  };
  const found = find(next.root, next.direction, next.width, next.height);
  if (!found) return null;
  const group = found.parent.children[found.index] as LayoutGroup;
  // The anchor's slot holds its group's tabs and the panels that become tabs there.
  const fitted = fitSlots(slots, anchor, found.width, found.height, (id, width, height, tabs) => roomFor(id === anchor ? [...group.panels, ...tabs] : [id], width, height, info));
  // The panels that don't fit open as tabs behind the anchor, which stays the one shown.
  group.panels.push(...fitted.tabs.filter((id) => !group.panels.includes(id)));
  const placed = [...slotPanels(fitted.slots).filter((id) => id !== anchor), ...fitted.tabs];
  if ("panel" in fitted.slots) return { layout: next, placed };
  // Splitting a group that fills the workspace would hide the new panels behind it.
  delete group.maximized;
  const build = (part: Slots, size: number, width: number, height: number): LayoutNode => {
    if ("panel" in part) return part.panel === anchor ? { ...group, size } : { kind: "group", size, panels: [part.panel], active: part.panel };
    const row = part.split === "row";
    const total = part.parts.reduce((sum, item) => sum + item.size, 0);
    const children = part.parts.map((item) => {
      const share = item.size / total;
      return row ? build(item.slots, width * share, width * share, height) : build(item.slots, height * share, width, height * share);
    });
    return { kind: "split", size, children };
  };
  const top = fitted.slots;
  if (top.split === found.direction) {
    // The layout runs the same way as the group's row (or column): its parts join it in the group's place, sharing its size.
    const total = top.parts.reduce((sum, item) => sum + item.size, 0);
    const row = top.split === "row";
    const parts = top.parts.map((item) => {
      const share = item.size / total;
      const node = build(item.slots, 0, row ? found.width * share : found.width, row ? found.height : found.height * share);
      return { ...node, size: group.size * share };
    });
    found.parent.children.splice(found.index, 1, ...parts);
  } else {
    found.parent.children[found.index] = build(top, group.size, found.width, found.height);
  }
  return { layout: next, placed };
}

/** Whether the row or column beside `group` has room for one more group holding panels `ids`. */
function fits(api: DockviewApi, group: DockviewGroupPanel, side: Side, ids: readonly string[], info: Info, leaving?: string) {
  const horizontal = side === "right";
  const line = lineOf(api, group, side, info);
  // The new group shares the target's size across the line.
  const need = leastAlong(ids, horizontal, horizontal ? group.height : group.width, info);
  // A group that empties by the move gives its room back to the line.
  const mins = line.mins.filter((_, i) => !leaving || line.members[i] !== leaving);
  return mins.reduce((sum, value) => sum + value, need) <= line.total;
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
  const dragged = data.panelId ? [data.panelId] : (source?.panels.map((panel) => panel.id) ?? []);
  const sideways = position === "left" || position === "right";
  if (!target) {
    // An outer edge: the new column or row runs the dock's full height or width, beside everything else.
    return sideways
      ? api.width - api.minimumWidth >= leastAlong(dragged, true, api.height, info)
      : api.height - api.minimumHeight >= leastAlong(dragged, false, api.width, info);
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
