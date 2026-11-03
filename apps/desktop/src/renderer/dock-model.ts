// Our own model of the dock: pure TypeScript, no DOM and no dockview code. It takes the saved dock layout (dockview's
// serialized grid), the panel (or group) that is dragged and a drop target, and says what the layout would be after
// the drop and which rectangle the dragged panel then occupies, or why the drop is refused.
//
// It follows what dockview 8.3.1 does for a drop, step by step (the splitview's resize / relayout / distribute rules,
// "Split" sizing of a new group, a group closing, a lone child lifted into its grandparent), so the preview matches the
// real result. dock-model.e2e checks that against the real dock; the drop in WorkspacePage.vue asserts it in dev.
//
// A later "full" preview (panels sliding aside while you drag) needs nothing new from here: it asks for `planDrop`
// per target and animates every group from `groupRects(layout)` to `plan.rects`.
import type { DockviewApi, DockviewGroupPanel, PanelTransfer, Position, SerializedDockview } from "dockview-vue";
import { dropAllowed, groupConstraints, type Constraints, type PanelInfo } from "./dock";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Side = "left" | "right" | "top" | "bottom";

/** What the pointer is aimed at. */
export type DropTarget =
  /** A new column (left, right) or row (top, bottom) beside a group. */
  | { kind: "split"; group: string; side: Side }
  /** A tab in a group; `index` is its place among the group's other tabs (the dragged one left out), else the end. */
  | { kind: "tab"; group: string; index?: number }
  /** The dock's outer edge: a column or row across everything. */
  | { kind: "edge"; side: Side };

/** A panel of a group, or (`panelId` null) the whole group. */
export interface Dragged {
  groupId: string;
  panelId: string | null;
}

/** `too-small`: a panel would get less room than its module asks for. `same-spot`: nothing would change. */
export type Refusal = "too-small" | "same-spot" | "unknown";

export type DropPlan =
  | {
      ok: true;
      /** The layout after the drop. A group made new by the drop has the id NEW_GROUP. */
      layout: SerializedDockview;
      /** Every visible group's rectangle after the drop, in the dock's own coordinates. */
      rects: Record<string, Rect>;
      /** The group the dragged panel ends up in, and its rectangle after the drop. */
      group: string;
      landing: Rect;
      /** Where the panel's tab ends up in its group. */
      tabIndex: number;
      /** The drop makes a group of its own for the panel. */
      newGroup: boolean;
    }
  | { ok: false; reason: Refusal };

export const NEW_GROUP = "new-group";
/** Space between cards, as the dock's theme sets it (GAP in WorkspacePage.vue). */
export const DOCK_GAP = 8;

type Axis = "HORIZONTAL" | "VERTICAL";
type GridNode = SerializedDockview["grid"]["root"];
type GroupState = Exclude<GridNode["data"], GridNode[]>;

const BIG = Number.MAX_SAFE_INTEGER;
const H: Axis = "HORIZONTAL";
const V: Axis = "VERTICAL";
const flip = (axis: Axis): Axis => (axis === H ? V : H);

interface Leaf {
  kind: "leaf";
  state: GroupState;
  id: string;
  views: string[];
  /** Size along the parent's axis; 0 while hidden. */
  size: number;
  cached?: number | undefined;
  parent?: Branch | undefined;
  c: Constraints;
}
interface Branch {
  kind: "branch";
  children: Node[];
  size: number;
  cached?: number | undefined;
  parent?: Branch | undefined;
  depth: number;
}
type Node = Leaf | Branch;
const visible = (node: Node) => node.cached === undefined;

/** How a view is sized when it is added to a splitview, as dockview's `Sizing`. */
type Sizing = number | { type: "split"; index: number } | { type: "distribute" } | { type: "invisible"; cached: number };
const DISTRIBUTE: Sizing = { type: "distribute" };

// ── Helpers copied from dockview's splitview ───────────────────────────

const clamp = (value: number, min: number, max: number) => (min > max ? min : Math.min(max, Math.max(value, min)));
const range = (from: number, to: number) => {
  const result: number[] = [];
  if (from <= to) for (let i = from; i < to; i++) result.push(i);
  else for (let i = from; i > to; i--) result.push(i);
  return result;
};
function pushToStart(list: number[], value: number) {
  const at = list.indexOf(value);
  if (at > -1) {
    list.splice(at, 1);
    list.unshift(value);
  }
}
function pushToEnd(list: number[], value: number) {
  const at = list.indexOf(value);
  if (at > -1) {
    list.splice(at, 1);
    list.push(value);
  }
}

/** The smallest or largest a node can be along `axis`; `orient` is the node's own split direction when it is a branch. */
function bound(node: Node, axis: Axis, orient: Axis, kind: "min" | "max"): number {
  if (node.kind === "leaf") {
    const c = node.c;
    return axis === H ? (kind === "min" ? c.minimumWidth : c.maximumWidth) : kind === "min" ? c.minimumHeight : c.maximumHeight;
  }
  const kids = node.children.filter(visible);
  const along = kids.map((child) => bound(child, axis, flip(orient), kind));
  if (axis === orient) return kind === "min" ? along.reduce((a, b) => a + b, 0) : kids.length ? along.reduce((a, b) => a + b, 0) : Infinity;
  return kind === "min" ? Math.max(0, ...along) : Math.min(Infinity, ...along);
}

// ── The grid ───────────────────────────────────────────────────────────

class Grid {
  root: Branch;
  rootAxis: Axis;
  readonly width: number;
  readonly height: number;

  constructor(
    json: SerializedDockview,
    private readonly margin: number,
  ) {
    this.rootAxis = json.grid.orientation as Axis;
    this.width = json.grid.width;
    this.height = json.grid.height;
    // dockview writes each view's size without its share of the gaps (a splitview of n views loses margin * (n - 1) / n
    // from each); the splitview itself works with the sizes that add up to its room, so they are put back.
    const parse = (node: GridNode, share: number): Node => {
      const hidden = node.visible === false;
      const base = hidden ? { size: 0, cached: node.size ?? 0 } : { size: (node.size ?? 0) + share };
      if (node.type === "branch") {
        const kids = node.data as GridNode[];
        const shown = kids.filter((kid) => kid.visible !== false).length;
        return { kind: "branch", children: kids.map((kid) => parse(kid, (this.margin * Math.max(0, shown - 1)) / Math.max(1, shown))), depth: 0, ...base };
      }
      const state = node.data as GroupState;
      return { kind: "leaf", state: { ...state }, id: state.id, views: [...state.views], c: { minimumWidth: 0, maximumWidth: BIG, minimumHeight: 0, maximumHeight: BIG }, ...base };
    };
    const root = parse(json.grid.root, 0);
    this.root = root.kind === "branch" ? root : { kind: "branch", children: [root], size: 0, depth: 0 };
    this.link();
  }

  /** Depths and parents; the root's size is its room across. */
  link() {
    this.root.size = this.rootAxis === H ? this.height : this.width;
    this.root.parent = undefined;
    const walk = (branch: Branch, depth: number) => {
      branch.depth = depth;
      for (const child of branch.children) {
        child.parent = branch;
        if (child.kind === "branch") walk(child, depth + 1);
      }
    };
    walk(this.root, 0);
  }

  /** What a splitview of its children takes off each of them for the gaps. */
  share(branch: Branch): number {
    const shown = branch.children.filter(visible).length;
    return (this.margin * Math.max(0, shown - 1)) / Math.max(1, shown);
  }
  /** A node's size along its parent's axis as dockview draws it (the gaps taken off). */
  reduced(node: Node): number {
    return node.size - (node.parent ? this.share(node.parent) : 0);
  }
  /** What dockview's `size` of a node reads: a group's drawn size along its parent's axis, a split's room along its own. */
  readSize(node: Node): number {
    return node.kind === "leaf" ? this.reduced(node) : this.extentOf(node);
  }

  axisOf(branch: Branch): Axis {
    return branch.depth % 2 === 0 ? this.rootAxis : flip(this.rootAxis);
  }
  /** The room a branch splits along its own axis. */
  extentOf(branch: Branch): number {
    return branch.parent ? this.reduced(branch.parent) : this.rootAxis === H ? this.width : this.height;
  }

  leaves(node: Node = this.root): Leaf[] {
    return node.kind === "leaf" ? [node] : node.children.flatMap((child) => this.leaves(child));
  }
  leaf(id: string): Leaf | undefined {
    return this.leaves().find((item) => item.id === id);
  }

  /** A node's place: the child index at every level from the root. */
  locate(target: Node, from: Branch = this.root, path: number[] = []): number[] | null {
    for (const [i, child] of from.children.entries()) {
      if (child === target) return [...path, i];
      if (child.kind === "branch") {
        const found = this.locate(target, child, [...path, i]);
        if (found) return found;
      }
    }
    return null;
  }
  node(path: number[]): Node {
    let node: Node = this.root;
    for (const i of path) {
      if (node.kind !== "branch" || !node.children[i]) throw new Error("Invalid location");
      node = node.children[i]!;
    }
    return node;
  }

  /** The axis of the branch that holds the node at `location`, as dockview's getLocationOrientation. */
  locationAxis(location: number[]): Axis {
    return location.length % 2 === 0 ? flip(this.rootAxis) : this.rootAxis;
  }
  /** Where a new sibling goes next to the node at `location`, as dockview's getRelativeLocation. */
  relative(location: number[], side: Side): number[] {
    const sideAxis = side === "top" || side === "bottom" ? V : H;
    if (this.locationAxis(location) === sideAxis) {
      const rest = location.slice(0, -1);
      return [...rest, location[location.length - 1]! + (side === "right" || side === "bottom" ? 1 : 0)];
    }
    return [...location, side === "right" || side === "bottom" ? 1 : 0];
  }

  // Splitview operations on one branch.

  private sizes(b: Branch) {
    return b.children.map((child) => child.size);
  }
  private min(b: Branch, i: number) {
    const child = b.children[i]!;
    return visible(child) ? bound(child, this.axisOf(b), child.kind === "branch" ? flip(this.axisOf(b)) : H, "min") : 0;
  }
  private max(b: Branch, i: number) {
    const child = b.children[i]!;
    return visible(child) ? bound(child, this.axisOf(b), child.kind === "branch" ? flip(this.axisOf(b)) : H, "max") : 0;
  }

  private resize(b: Branch, index: number, delta: number, low?: number[], high?: number[]) {
    const sizes = this.sizes(b);
    const items = b.children;
    if (index < 0 || index > items.length) return;
    const up = range(index, -1);
    const down = range(index + 1, items.length);
    if (high)
      for (const i of high) {
        pushToStart(up, i);
        pushToStart(down, i);
      }
    if (low)
      for (const i of low) {
        pushToEnd(up, i);
        pushToEnd(down, i);
      }
    const minDeltaUp = up.reduce((sum, i) => sum + this.min(b, i) - sizes[i]!, 0);
    const maxDeltaUp = up.reduce((sum, i) => sum + this.max(b, i) - sizes[i]!, 0);
    const maxDeltaDown = down.length === 0 ? Infinity : down.reduce((sum, i) => sum + sizes[i]! - this.min(b, i), 0);
    const minDeltaDown = down.length === 0 ? -Infinity : down.reduce((sum, i) => sum + sizes[i]! - this.max(b, i), 0);
    const minDelta = Math.max(minDeltaUp, minDeltaDown);
    const maxDelta = Math.min(maxDeltaDown, maxDeltaUp);
    const tentative = clamp(delta, minDelta, maxDelta);
    let actual = 0;
    let deltaUp = tentative;
    for (const i of up) {
      const prior = sizes[i]!;
      const size = clamp(prior + deltaUp, this.min(b, i), this.max(b, i));
      actual += size - prior;
      deltaUp -= size - prior;
      items[i]!.size = size;
    }
    let deltaDown = actual;
    for (const i of down) {
      const prior = sizes[i]!;
      const size = clamp(prior - deltaDown, this.min(b, i), this.max(b, i));
      deltaDown += size - prior;
      items[i]!.size = size;
    }
  }

  private distributeEmpty(b: Branch, lowIndex?: number) {
    let emptyDelta = this.extentOf(b) - this.sizes(b).reduce((sum, size) => sum + size, 0);
    if (emptyDelta === 0) return;
    const indexes = range(b.children.length - 1, -1);
    if (lowIndex !== undefined) pushToEnd(indexes, lowIndex);
    for (let n = 0; emptyDelta !== 0 && n < indexes.length; n++) {
      const i = indexes[n]!;
      const item = b.children[i]!;
      const size = clamp(item.size + emptyDelta, this.min(b, i), this.max(b, i));
      emptyDelta -= size - item.size;
      item.size = size;
    }
  }

  /** What dockview does when the room or a view changed: pour the difference into the views, then lay out the nested splits. */
  private relayout(b: Branch, low?: number[], high?: number[]) {
    const content = this.sizes(b).reduce((sum, size) => sum + size, 0);
    this.resize(b, b.children.length - 1, this.extentOf(b) - content, low, high);
    this.distributeEmpty(b);
    this.settle(b);
  }

  /** Nested splits get their new room, kept in proportion. */
  private settle(b: Branch) {
    for (const child of b.children) {
      if (child.kind !== "branch") continue;
      this.link();
      const content = this.sizes(child).reduce((sum, size) => sum + size, 0);
      if (content > 0) {
        const props = child.children.map((item) => (visible(item) ? item.size / content : undefined));
        const total = props.reduce<number>((sum, p) => sum + (p ?? 0), 0);
        let room = this.extentOf(child);
        child.children.forEach((item, i) => {
          if (props[i] === undefined) room -= item.size;
        });
        child.children.forEach((item, i) => {
          if (props[i] !== undefined && total > 0) item.size = clamp(Math.round((props[i]! * room) / total), this.min(child, i), this.max(child, i));
        });
      }
      this.distributeEmpty(child);
      this.settle(child);
    }
  }

  private distribute(b: Branch) {
    const flexible = b.children.map((_, i) => i).filter((i) => this.max(b, i) - this.min(b, i) > 0);
    const total = flexible.reduce((sum, i) => sum + b.children[i]!.size, 0);
    const size = Math.floor(total / flexible.length);
    for (const i of flexible) b.children[i]!.size = clamp(size, this.min(b, i), this.max(b, i));
    this.relayout(b, [], []);
  }

  addChild(b: Branch, node: Node, sizing: Sizing, index: number, skipLayout = false) {
    this.link();
    let size: number;
    if (typeof sizing === "number") size = sizing;
    else if (sizing.type === "split") {
      const target = b.children[sizing.index];
      if (target) {
        const half = Math.floor(target.size / 2);
        size = target.size - half;
        target.size = half;
      } else size = -0.5;
    } else if (sizing.type === "invisible") {
      size = 0;
      node.cached = sizing.cached;
    } else {
      // The view's own minimum; known once it sits in the splitview.
      size = -1;
    }
    node.size = size;
    if (typeof sizing === "number" || sizing.type !== "invisible") node.cached = undefined;
    b.children.splice(index, 0, node);
    this.link();
    if (size === -1) node.size = this.min(b, index);
    if (!skipLayout) {
      this.relayout(b, [index]);
      if (typeof sizing !== "number" && sizing.type === "distribute") this.distribute(b);
    }
  }

  removeChild(b: Branch, index: number, sizing?: Sizing, skipLayout = false): Node {
    const [node] = b.children.splice(index, 1);
    this.link();
    if (!skipLayout) this.relayout(b);
    if (sizing && typeof sizing !== "number" && sizing.type === "distribute" && b.children.length) this.distribute(b);
    return node!;
  }

  /** Sizes a group again within its (new) constraints; its neighbours give or take the difference. */
  reclamp(leaf: Leaf) {
    const parent = leaf.parent;
    if (parent) this.resizeChild(parent, parent.children.indexOf(leaf), leaf.size);
  }

  private resizeChild(b: Branch, index: number, size: number) {
    const item = b.children[index];
    if (!item) return;
    const low = [index];
    item.size = clamp(Math.round(size), this.min(b, index), Math.min(this.max(b, index), this.extentOf(b)));
    this.relayout(b, low, []);
  }

  /** Moves a view to another place in the same splitview, keeping its size. */
  moveChild(b: Branch, from: number, to: number) {
    if (from === to) return;
    if (from < to) to--;
    const node = this.removeChild(b, from, undefined, true);
    const size = node.cached === undefined ? node.size : ({ type: "invisible", cached: node.cached } as Sizing);
    const keep = node.cached;
    node.cached = undefined;
    this.addChild(b, node, size, to);
    if (keep !== undefined) node.cached = keep;
  }

  // Gridview operations.

  /** Adds a group at `location`, beside an existing one or wrapped with it in a new split. */
  addView(leaf: Leaf, sizing: Sizing, location: number[]) {
    const rest = location.slice(0, -1);
    const index = location[location.length - 1]!;
    const parent = this.node(rest);
    if (parent.kind === "branch") {
      this.addChild(parent, leaf, sizing, index);
      return;
    }
    const grand = this.node(rest.slice(0, -1)) as Branch;
    const parentIndex = rest[rest.length - 1]!;
    const siblingSize: Sizing = parent.cached === undefined ? 0 : { type: "invisible", cached: parent.cached };
    const size = this.readSize(parent);
    this.removeChild(grand, parentIndex);
    const wrapper: Branch = { kind: "branch", children: [], size, depth: 0 };
    this.addChild(grand, wrapper, size, parentIndex);
    parent.cached = undefined;
    this.addChild(wrapper, parent, siblingSize, 0);
    const split = typeof sizing === "object" && sizing.type === "split" ? { type: "split" as const, index: 0 } : sizing;
    this.addChild(wrapper, leaf, split, index);
  }

  /** Takes a group out; a split left with one child gives that child to its parent. */
  removeView(leaf: Leaf, sizing?: Sizing) {
    const location = this.locate(leaf);
    if (!location) throw new Error("Invalid location");
    const rest = location.slice(0, -1);
    const index = location[location.length - 1]!;
    const parent = this.node(rest) as Branch;
    this.removeChild(parent, index, sizing);
    if (parent.children.length !== 1) return;
    const sibling = parent.children[0]!;
    if (rest.length === 0) {
      if (sibling.kind === "leaf") return;
      this.removeChild(parent, 0, sizing);
      this.root = sibling;
      this.rootAxis = flip(this.rootAxis);
      this.link();
      return;
    }
    const grand = this.node(rest.slice(0, -1)) as Branch;
    const parentIndex = rest[rest.length - 1]!;
    const siblingVisible = visible(sibling);
    const siblingCached = sibling.cached;
    const parentSize = this.reduced(parent);
    // dockview 8.8 lifts a split's children by their size along the parent's axis (before, a split's own axis was read).
    const liftedSizes = sibling.kind === "branch" ? sibling.children.map((child) => this.reduced(child)) : [];
    this.removeChild(parent, 0, sizing);
    const sizes = grand.children.map((child) => child.size);
    this.removeChild(grand, parentIndex, sizing);
    if (sibling.kind === "branch") {
      sizes.splice(parentIndex, 1, ...liftedSizes);
      const kids = [...sibling.children];
      sibling.children = [];
      kids.forEach((child, i) => this.addChild(grand, child, liftedSizes[i]!, parentIndex + i));
    } else {
      sibling.cached = undefined;
      this.addChild(grand, sibling, siblingVisible ? parentSize : { type: "invisible", cached: siblingCached ?? parentSize }, parentIndex);
    }
    for (let i = 0; i < sizes.length; i++) this.resizeChild(grand, i, sizes[i]!);
  }

  /** A root with one split inside becomes that split. */
  normalize() {
    if (this.root.children.length !== 1) return;
    const only = this.root.children[0]!;
    if (only.kind === "leaf") return;
    this.root = only;
    this.rootAxis = flip(this.rootAxis);
    this.link();
  }

  /** Puts the root inside a new split across it, so a group can be added along an edge it did not have. */
  insertOrthogonalAtRoot() {
    const old = this.root;
    const axis = flip(this.rootAxis);
    const root: Branch = { kind: "branch", children: [], size: 0, depth: 0 };
    const oldSize = old.size;
    this.root = root;
    this.rootAxis = axis;
    this.link();
    if (old.children.length === 1) {
      const only = old.children[0]!;
      if (only.kind === "leaf") {
        this.addChild(root, only, DISTRIBUTE, 0);
        return;
      }
      // dockview flips the whole tree under it; the sizes are the same ones seen from the other side.
      this.addChild(root, this.flipped(only), DISTRIBUTE, 0);
      return;
    }
    old.size = oldSize;
    this.addChild(root, old, DISTRIBUTE, 0);
  }

  /** The same split seen with the other axis (dockview's flipNode): sizes follow in proportion. */
  private flipped(node: Branch): Branch {
    const result: Branch = { kind: "branch", children: [], size: node.size, depth: 0 };
    const total = node.children.reduce((sum, child) => sum + child.size, 0);
    const room = node.size;
    let used = 0;
    const kids = [...node.children].reverse().map((child, n, all) => {
      let size = total === 0 ? 0 : Math.round((room * child.size) / total);
      used += size;
      if (n === all.length - 1) size += room - used;
      child.size = size;
      return child.kind === "branch" ? this.flipped(Object.assign(child, { size })) : child;
    });
    result.children = kids.reverse();
    return result;
  }

  emptyLeaf(): Leaf {
    return { kind: "leaf", state: { id: NEW_GROUP, views: [] } as GroupState, id: NEW_GROUP, views: [], size: 0, c: { minimumWidth: 100, maximumWidth: BIG, minimumHeight: 100, maximumHeight: BIG } };
  }

  // Output.

  toJSON(base: SerializedDockview): SerializedDockview {
    const out = (node: Node, share: number): GridNode => {
      const hidden = node.cached !== undefined ? { visible: false } : {};
      const size = node.cached ?? node.size - share;
      if (node.kind === "branch") {
        const shown = node.children.filter(visible).length;
        return { type: "branch", size, ...hidden, data: node.children.map((child) => out(child, (this.margin * Math.max(0, shown - 1)) / Math.max(1, shown))) } as GridNode;
      }
      const active = node.state.activeView && node.views.includes(node.state.activeView) ? node.state.activeView : node.views[0];
      return { type: "leaf", size, ...hidden, data: { ...node.state, id: node.id, views: [...node.views], ...(active ? { activeView: active } : {}) } } as GridNode;
    };
    return { ...base, grid: { ...base.grid, root: { ...out(this.root, 0), size: this.rootAxis === H ? this.height : this.width }, orientation: this.rootAxis as never } };
  }

  /** Where each visible group is drawn, as dockview lays a splitview out with its gaps. */
  rects(margin: number): Record<string, Rect> {
    const result: Record<string, Rect> = {};
    const place = (branch: Branch, box: Rect) => {
      const axis = this.axisOf(branch);
      const shown = branch.children.filter(visible).length;
      const sashes = Math.max(0, shown - 1);
      const reduced = (margin * sashes) / Math.max(1, shown);
      let before = 0;
      let seen = 0;
      branch.children.forEach((child, i) => {
        const isVisible = visible(child);
        if (isVisible) seen++;
        const size = isVisible ? child.size - reduced : 0;
        const earlier = Math.max(0, seen - 1);
        const offset = i === 0 || earlier === 0 ? 0 : before + (earlier / sashes) * reduced;
        before += child.size;
        if (!isVisible) return;
        const rect: Rect = axis === H ? { x: box.x + offset, y: box.y, width: size, height: box.height } : { x: box.x, y: box.y + offset, width: box.width, height: size };
        if (child.kind === "leaf") result[child.id] = rect;
        else place(child, rect);
      });
    };
    place(this.root, { x: 0, y: 0, width: this.width, height: this.height });
    return result;
  }

  /** Each group's constraints, worked out from where it is drawn (what Tavora keeps set on the live groups). */
  constrain(info: (id: string) => PanelInfo | undefined, margin: number) {
    const rects = this.rects(margin);
    for (const leaf of this.leaves()) {
      const rect = rects[leaf.id];
      if (rect) leaf.c = groupConstraints({ width: rect.width, height: rect.height, panels: leaf.views.map((id) => ({ id })) }, info);
    }
  }
}

/** Every visible group's rectangle in a saved dock layout, in the dock's own coordinates. */
export function groupRects(layout: SerializedDockview, margin = DOCK_GAP): Record<string, Rect> {
  return new Grid(layout, margin).rects(margin);
}

/** The smallest room a layout needs across the whole dock, along each axis. */
function dockMinimum(grid: Grid, axis: Axis): number {
  return bound(grid.root, axis, grid.rootAxis, "min");
}

/** The model's stand-in for dockview's api, enough for `dropAllowed`. */
function stand(layout: SerializedDockview, grid: Grid, rects: Record<string, Rect>): DockviewApi {
  const group = (leaf: Leaf) => {
    const rect = rects[leaf.id] ?? { x: 0, y: 0, width: 0, height: 0 };
    return { id: leaf.id, width: rect.width, height: rect.height, panels: leaf.views.map((id) => ({ id })) };
  };
  const groups = grid.leaves().map(group);
  return {
    width: grid.width,
    height: grid.height,
    minimumWidth: dockMinimum(grid, H),
    minimumHeight: dockMinimum(grid, V),
    toJSON: () => layout,
    getGroup: (id: string) => groups.find((item) => item.id === id),
    groups,
  } as unknown as DockviewApi;
}

const POSITION: Record<DropTarget["kind"], (target: DropTarget) => Position> = {
  split: (target) => (target as { side: Side }).side,
  edge: (target) => (target as { side: Side }).side,
  tab: () => "center",
};

/**
 * What a drop does. `info` says how much room each panel needs, `margin` is the dock's gap. A refused drop says why;
 * nothing is changed in `layout`.
 */
export function planDrop(layout: SerializedDockview, dragged: Dragged, target: DropTarget, info: (id: string) => PanelInfo | undefined, margin = DOCK_GAP): DropPlan {
  try {
    return plan(layout, dragged, target, info, margin);
  } catch {
    return { ok: false, reason: "unknown" };
  }
}

function plan(layout: SerializedDockview, dragged: Dragged, target: DropTarget, info: (id: string) => PanelInfo | undefined, margin: number): DropPlan {
  const grid = new Grid(layout, margin);
  const rects0 = grid.rects(margin);
  grid.constrain(info, margin);
  const source = grid.leaf(dragged.groupId);
  if (!source || (dragged.panelId !== null && !source.views.includes(dragged.panelId))) return { ok: false, reason: "unknown" };
  const reference = target.kind === "edge" ? undefined : grid.leaf(target.group);
  if (target.kind !== "edge" && !reference) return { ok: false, reason: "unknown" };

  // The same rule the live dock applies (guardDrop).
  const api = stand(layout, grid, rects0);
  const transfer = { viewId: "", groupId: dragged.groupId, panelId: dragged.panelId ?? undefined } as unknown as PanelTransfer;
  if (!dropAllowed(api, info, transfer, reference ? (api.getGroup(reference.id) as unknown as DockviewGroupPanel) : undefined, POSITION[target.kind](target))) return { ok: false, reason: "too-small" };

  const whole = dragged.panelId === null;
  const moved = whole ? [...source.views] : [dragged.panelId!];
  let landing: Leaf | undefined;
  let newGroup = false;
  let tabIndex = 0;

  const placeInNewGroup = (side: Side, ref: Leaf) => {
    const dropSplit = (reference: Leaf): Sizing => ({ type: "split", index: grid.locate(reference)!.at(-1) ?? 0 });
    if (whole) {
      if (ref === source) return "same" as const;
      const from = grid.locate(source)!;
      const to = grid.locate(ref)!;
      const sideAxis = side === "top" || side === "bottom" ? V : H;
      const reorder = from.length > 0 && to.length > 0 && from.slice(0, -1).join() === to.slice(0, -1).join() && grid.locationAxis(to) === sideAxis;
      const size = reorder ? (sideAxis === H ? rects0[source.id]!.width : rects0[source.id]!.height) : undefined;
      grid.removeView(source);
      grid.addView(source, size ?? dropSplit(ref), grid.relative(grid.locate(ref)!, side));
      landing = source;
      return "done" as const;
    }
    if (source.views.length < 2) {
      if (ref === source) return "same" as const;
      const targetLocation = grid.relative(grid.locate(ref)!, side);
      const sourceLocation = grid.locate(source)!;
      const targetParent = targetLocation.slice(0, -1);
      const to = targetLocation[targetLocation.length - 1]!;
      if (sourceLocation.slice(0, -1).join() === targetParent.join() && grid.node(targetParent).kind === "branch") {
        const from = sourceLocation[sourceLocation.length - 1]!;
        if (from === to || from + 1 === to) return "same" as const;
        grid.moveChild(grid.node(targetParent) as Branch, from, to);
      } else {
        grid.removeView(source, DISTRIBUTE);
        grid.addView(source, dropSplit(ref), grid.relative(grid.locate(ref)!, side));
      }
      landing = source;
      return "done" as const;
    }
    source.views = source.views.filter((id) => id !== dragged.panelId);
    const fresh = grid.emptyLeaf();
    fresh.views = [dragged.panelId!];
    fresh.state = { ...fresh.state, views: fresh.views };
    grid.addView(fresh, dropSplit(ref), grid.relative(grid.locate(ref)!, side));
    // dockview 8.8 re-clamps a group once its panel's constraints are set, taking the room it lacks from its neighbours.
    const room = grid.rects(margin)[fresh.id];
    if (room) {
      fresh.c = { ...fresh.c, ...groupConstraints({ width: room.width, height: room.height, panels: [{ id: dragged.panelId! }] }, info) };
      grid.reclamp(fresh);
    }
    landing = fresh;
    newGroup = true;
    return "done" as const;
  };

  if (target.kind === "tab") {
    const into = reference!;
    if (whole) {
      if (into === source) return { ok: false, reason: "same-spot" };
      grid.removeView(source, DISTRIBUTE);
      tabIndex = into.views.length;
      into.views.push(...moved);
    } else if (into === source) {
      const others = source.views.filter((id) => id !== dragged.panelId);
      const at = Math.min(Math.max(target.index ?? others.length, 0), others.length);
      const next = [...others.slice(0, at), dragged.panelId!, ...others.slice(at)];
      if (next.join() === source.views.join()) return { ok: false, reason: "same-spot" };
      source.views = next;
      tabIndex = at;
    } else {
      source.views = source.views.filter((id) => id !== dragged.panelId);
      if (source.views.length === 0) grid.removeView(source, DISTRIBUTE);
      const at = Math.min(Math.max(target.index ?? into.views.length, 0), into.views.length);
      into.views.splice(at, 0, dragged.panelId!);
      tabIndex = at;
    }
    landing = into;
  } else if (target.kind === "split") {
    const result = placeInNewGroup(target.side, reference!);
    if (result === "same") return { ok: false, reason: "same-spot" };
    tabIndex = whole ? 0 : landing!.views.indexOf(dragged.panelId!);
  } else {
    // The dock's outer edge: an empty group is added there, then the panel moves into it.
    grid.normalize();
    const vertical = target.side === "top" || target.side === "bottom";
    if (vertical && grid.rootAxis === H) grid.insertOrthogonalAtRoot();
    if (!vertical && grid.rootAxis === V) grid.insertOrthogonalAtRoot();
    const empty = grid.emptyLeaf();
    grid.addView(empty, DISTRIBUTE, [target.side === "left" || target.side === "top" ? 0 : grid.root.children.length]);
    grid.constrain(info, margin);
    empty.c = { ...empty.c, ...groupConstraints({ width: 0, height: 0, panels: [] }, info) };
    if (whole || source.views.length === 1) grid.removeView(source, DISTRIBUTE);
    source.views = source.views.filter((id) => !moved.includes(id));
    empty.views = moved;
    empty.state = { ...empty.state, views: moved };
    landing = empty;
    newGroup = true;
    tabIndex = whole ? 0 : 0;
  }

  const rects = grid.rects(margin);
  if (!landing) return { ok: false, reason: "unknown" };
  const rect = rects[landing.id];
  if (!rect) return { ok: false, reason: "unknown" };
  return { ok: true, layout: grid.toJSON(layout), rects, group: landing.id, landing: rect, tabIndex, newGroup };
}

/**
 * Where two layouts differ (the model's against dockview's after the same drop): the shape, the tabs and the sizes
 * to within a pixel. Empty when they are the same. The group the drop made new may have any id.
 */
export function diffLayouts(model: SerializedDockview, real: SerializedDockview, tolerance = 1): string[] {
  const out: string[] = [];
  if (model.grid.orientation !== real.grid.orientation) out.push(`orientation ${model.grid.orientation} vs ${real.grid.orientation}`);
  const walk = (a: GridNode, b: GridNode, path: string) => {
    if (a.type !== b.type) return void out.push(`${path || "/"}: ${a.type} vs ${b.type}`);
    if (Math.abs((a.size ?? 0) - (b.size ?? 0)) > tolerance) out.push(`${path || "/"}: size ${a.size} vs ${b.size}`);
    if (a.type === "branch") {
      const x = a.data as GridNode[];
      const y = b.data as GridNode[];
      if (x.length !== y.length) return void out.push(`${path || "/"}: ${x.length} children vs ${y.length}`);
      x.forEach((child, i) => walk(child, y[i]!, `${path}/${i}`));
    } else {
      const x = a.data as GroupState;
      const y = b.data as GroupState;
      if (x.views.join() !== y.views.join()) out.push(`${path}: tabs ${x.views.join()} vs ${y.views.join()}`);
    }
  };
  walk(model.grid.root, real.grid.root, "");
  return out;
}
