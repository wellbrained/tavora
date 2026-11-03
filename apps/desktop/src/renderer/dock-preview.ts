// The drop preview while a panel is dragged: nothing moves. The dragged panel's group fades, and a rectangle from the
// layout model (dock-model.ts) shows where it will land. This file reads the dock's DOM once when the drag starts, aims
// with dock-aim.ts, asks the model, and sets the few things that live in dockview's own elements (the fade, the tabs
// that make room). DockPreview.vue draws the rest. The drag's steps are dock-drag.ts.
import { getPanelData, type DockviewApi, type DockviewGroupPanel } from "dockview-vue";
import { shallowRef } from "vue";
import { aimAt, type Slot } from "./dock-aim";
import { applyDrop } from "./dock-drop";
import { dockDragStep, type DockDrag, type DockDragEvent, type DockDragStep } from "./dock-drag";
import { diffLayouts, planDrop, type Dragged, type DropPlan, type DropTarget, type Rect } from "./dock-model";
import type { PanelInfo } from "./dock";

/** What DockPreview.vue draws. All rectangles are in the dock's own coordinates. */
export interface PreviewView {
  /** Where the dock sits inside the preview's layer. */
  origin: { x: number; y: number };
  width: number;
  height: number;
  title: string;
  target: DropTarget | null;
  plan: DropPlan | null;
  /** Where each group is now (nothing moves while dragging). */
  rects: Record<string, Rect>;
  /** The dashed tab for a drop into a tab strip. */
  ghost: Rect | null;
  /** Too little room in the strip to open a gap: the ghost is a thin bar between the tabs. */
  bar: boolean;
}

interface Tab {
  el: HTMLElement;
  left: number;
  width: number;
  dragged: boolean;
}

/** What a drag reads of the dock when it starts; nothing moves until the drop. */
interface Scene {
  layout: ReturnType<DockviewApi["toJSON"]>;
  box: DOMRect;
  /** Where the dock sits inside the preview's layer. */
  origin: { x: number; y: number };
  title: string;
  rects: Record<string, Rect>;
  tabs: Map<string, Tab[]>;
  slots: Record<string, Slot[]>;
  /** Where each group's tab row ends (its tabs are clipped there), in the dock's coordinates. */
  stripEnd: Record<string, number>;
  stripStart: Record<string, number>;
  tabWidth: number;
  /** The dragged panel's group, faded while it is dragged. */
  lifted: HTMLElement | null;
}

type Moving = Exclude<DockDrag<Scene>, { phase: "idle" }>;

const LIFTED = "dock-lifted";
const AIMING = "data-dock-aiming";
const GHOST_GAP = 4;
/** The narrowest dashed tab worth showing; with less room the ghost is a bar. */
const MIN_GHOST = 56;
const BAR = 4;
/** A drag image nobody can see: our preview is the only picture of what is dragged. */
const NO_IMAGE = Object.assign(new Image(1, 1), { src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" });

export class DockPreview {
  readonly view = shallowRef<PreviewView | null>(null);
  private drag: DockDrag<Scene> = { phase: "idle" };

  constructor(
    private readonly dock: () => DockviewApi | null,
    private readonly root: () => HTMLElement | null,
    private readonly info: (id: string) => PanelInfo | undefined,
    private readonly onDone: () => void,
    private readonly isDev: () => boolean,
  ) {}

  get active(): boolean {
    return this.drag.phase !== "idle";
  }

  /** Dragover and drop go through here first; true when this is the dock's drop and dockview must not see it. */
  private readonly onOver = (event: DragEvent) => {
    const inside = this.take(event);
    if (!inside) return void (this.active && this.setTarget(null));
    event.preventDefault();
    event.stopPropagation();
    this.aim(event.clientX, event.clientY);
    // A refused drop, or a place with no target at all (a gap, a sash), shows the not-allowed cursor; a drop on the same
    // spot does nothing but is still a place to let go, so it keeps the move cursor (and says "Same place").
    const plan = this.drag.phase === "aiming" ? this.drag.plan : null;
    if (event.dataTransfer) event.dataTransfer.dropEffect = plan && (plan.ok || plan.reason === "same-spot") ? "move" : "none";
  };
  private readonly onEnter = (event: DragEvent) => {
    if (!this.take(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  private readonly onDrop = (event: DragEvent) => {
    if (!this.take(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.aim(event.clientX, event.clientY);
    const { drop } = this.apply({ type: "drop" });
    const dock = this.dock();
    if (dock && drop) this.commit(dock, drop.dragged, drop.target, drop.plan);
    this.onDone();
  };
  /** Dragend without a drop on the dock: Escape, or let go anywhere else (outside the window too). */
  private readonly onEnd = () => {
    if (!this.active) return;
    this.apply({ type: "end" });
    this.onDone();
  };

  /** After dockview's own handler, so its picture of the tab (which would show a second copy next to ours) is replaced. */
  private readonly onStart = (event: DragEvent) => {
    if (getPanelData()) event.dataTransfer?.setDragImage(NO_IMAGE, 0, 0);
  };

  attach(): void {
    addEventListener("dragstart", this.onStart);
    addEventListener("dragenter", this.onEnter, true);
    addEventListener("dragover", this.onOver, true);
    addEventListener("drop", this.onDrop, true);
    addEventListener("dragend", this.onEnd, true);
  }
  detach(): void {
    removeEventListener("dragstart", this.onStart);
    removeEventListener("dragenter", this.onEnter, true);
    removeEventListener("dragover", this.onOver, true);
    removeEventListener("drop", this.onDrop, true);
    removeEventListener("dragend", this.onEnd, true);
    this.stop();
  }

  /** Takes one step of the drag; one that ends it puts dockview's elements back and hides the preview. */
  private apply(event: DockDragEvent<Scene>): DockDragStep<Scene> {
    const before = this.drag;
    const step = dockDragStep(before, event);
    this.drag = step.drag;
    if (before.phase !== "idle" && step.drag.phase === "idle") {
      this.reset(before.scene);
      this.view.value = null;
    }
    return step;
  }

  /** Starts on the first drag event of a panel or group drag over the dock; false for anything else. */
  private take(event: DragEvent): boolean {
    const data = getPanelData();
    const dock = this.dock();
    const root = this.root();
    const dockEl = root?.querySelector<HTMLElement>(".dv-dockview");
    if (!data || !dock || !root || !dockEl) return false;
    if (!this.active) this.start(dock, root, dockEl, { groupId: data.groupId, panelId: data.panelId });
    const box = this.drag.phase === "idle" ? null : this.drag.scene.box;
    return !!box && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  }

  private start(dock: DockviewApi, root: HTMLElement, dockEl: HTMLElement, dragged: Dragged): void {
    const box = dockEl.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    const rects: Scene["rects"] = {};
    const tabsOf: Scene["tabs"] = new Map();
    const slotsOf: Scene["slots"] = {};
    const stripEnd: Scene["stripEnd"] = {};
    const stripStart: Scene["stripStart"] = {};
    for (const group of dock.groups as DockviewGroupPanel[]) {
      if (!group.api.isVisible) continue;
      const r = group.element.getBoundingClientRect();
      rects[group.id] = { x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height };
      const tabs: Tab[] = [...group.element.querySelectorAll<HTMLElement>(".dv-tab")].map((el) => {
        const t = el.getBoundingClientRect();
        return { el, left: t.left - box.left, width: t.width, dragged: !!dragged.panelId && !!el.querySelector(`[data-testid="panel-${dragged.panelId}"]`) };
      });
      tabsOf.set(group.id, tabs);
      // The tabs that stay, where they sit once the dragged one is gone.
      let shift = 0;
      const slots: Slot[] = [];
      for (const tab of tabs) {
        if (tab.dragged) shift = tab.width;
        else slots.push({ left: tab.left - shift, width: tab.width });
      }
      slotsOf[group.id] = slots;
      const row = group.element.querySelector<HTMLElement>(".dv-tabs-container");
      stripStart[group.id] = row ? row.getBoundingClientRect().left - box.left : r.left - box.left;
      // The tabs may use all the room up to the group's header buttons: the row's own box is only part of it (the empty
      // space after the tabs is a separate, growing element), and the tab row grows over it while aiming (dock.css), so tabs that slide into that space stay in sight.
      const header = group.element.querySelector<HTMLElement>(".dv-tabs-and-actions-container");
      const actions = group.element.querySelector<HTMLElement>(".dv-right-actions-container");
      const actionsBox = actions?.getBoundingClientRect();
      const end = actionsBox && actionsBox.width > 0 ? actionsBox.left : (header?.getBoundingClientRect().right ?? r.right);
      stripEnd[group.id] = end - box.left;
    }
    const source = dock.getGroup(dragged.groupId) as DockviewGroupPanel | undefined;
    const own = tabsOf.get(dragged.groupId)?.find((tab) => tab.dragged);
    const panel = dragged.panelId ?? source?.activePanel?.id ?? source?.panels[0]?.id;
    const scene: Scene = {
      layout: dock.toJSON(),
      box,
      origin: { x: box.left - rootBox.left, y: box.top - rootBox.top },
      title: (panel && this.info(panel)?.title) || "",
      rects,
      tabs: tabsOf,
      slots: slotsOf,
      stripEnd,
      stripStart,
      tabWidth: own?.width ?? tabsOf.get(dragged.groupId)?.[0]?.width ?? 140,
      lifted: source?.element ?? null,
    };
    this.apply({ type: "start", dragged, scene });
    scene.lifted?.classList.add(LIFTED);
    if (own) own.el.style.visibility = "hidden";
    root.setAttribute(AIMING, "");
    this.publish();
  }

  private aim(clientX: number, clientY: number): void {
    if (this.drag.phase === "idle") return;
    const { box, rects, slots } = this.drag.scene;
    const target = aimAt({ width: box.width, height: box.height, rects, slots }, clientX - box.left, clientY - box.top);
    this.setTarget(target);
  }

  private setTarget(target: DropTarget | null): void {
    const { changed } = this.apply({ type: "aim", target, plan: (dragged, scene, aimed) => planDrop(scene.layout, dragged, aimed, this.info) });
    if (!changed) return;
    this.slide();
    this.publish();
  }

  /** The tab strip aimed into, where the plan allows it: the group and the slot among its tabs. */
  private static into(drag: Moving): { group: string; index: number } | null {
    if (drag.phase !== "aiming" || drag.target.kind !== "tab" || !drag.plan.ok) return null;
    const group = drag.target.group;
    return { group, index: drag.target.index ?? drag.scene.slots[group]?.length ?? 0 };
  }

  /**
   * How a tab slot opens in a group's strip: the dashed tab's width and how far the tabs after the slot move. The strip
   * clips its tabs, so the gap is only as wide as the room left at its end; with less than a small tab's worth the
   * ghost is a bar and nothing moves, so no tab is ever pushed out of sight.
   */
  private static gap(scene: Scene, group: string): { width: number; shift: number; bar: boolean } {
    const slots = scene.slots[group] ?? [];
    const last = slots.at(-1);
    const end = last ? last.left + last.width : (scene.rects[group]?.x ?? 0);
    const room = (scene.stripEnd[group] ?? Infinity) - end - GHOST_GAP;
    const width = Math.min(scene.tabWidth, room);
    if (width < MIN_GHOST) return { width: BAR, shift: 0, bar: true };
    return { width, shift: width + GHOST_GAP, bar: false };
  }

  /** The tabs of the group aimed at make room for the dashed one. */
  private slide(): void {
    const drag = this.drag;
    if (drag.phase === "idle") return;
    const into = DockPreview.into(drag);
    const open = into ? DockPreview.gap(drag.scene, into.group).shift : 0;
    for (const [group, tabs] of drag.scene.tabs) {
      if (group !== into?.group && !tabs.some((tab) => tab.el.style.transform)) continue;
      let remaining = 0;
      let shift = 0;
      for (const tab of tabs) {
        if (tab.dragged) {
          shift = tab.width;
          continue;
        }
        tab.el.style.transform = group === into?.group ? `translateX(${(remaining >= into.index ? open : 0) - shift}px)` : "";
        remaining++;
      }
    }
  }

  private publish(): void {
    const drag = this.drag;
    if (drag.phase === "idle") return;
    const { scene } = drag;
    const into = DockPreview.into(drag);
    let ghost: Rect | null = null;
    let bar = false;
    if (into) {
      const rect = scene.rects[into.group];
      const slots = scene.slots[into.group] ?? [];
      const { index } = into;
      const last = slots.at(-1);
      const slotX = index < slots.length ? slots[index]!.left : last ? last.left + last.width + GHOST_GAP : (rect?.x ?? 0) + 6;
      // A tab row that scrolls can have its slot out of sight: the ghost stays inside the visible part of the row.
      const x = Math.max(slotX, scene.stripStart[into.group] ?? slotX);
      const gap = DockPreview.gap(scene, into.group);
      bar = gap.bar;
      if (rect) {
        // A bar sits on the line between two tabs, and inside the first or last tab at the ends, clear of the group's outline.
        const at = index === 0 ? x + 3 : index >= slots.length ? x - GHOST_GAP - BAR - 3 : x - BAR / 2 - GHOST_GAP / 2;
        ghost = bar ? { x: at, y: rect.y + 3, width: BAR, height: 30 } : { x, y: rect.y + 4, width: gap.width, height: 28 };
      }
    }
    const aiming = drag.phase === "aiming" ? drag : null;
    this.view.value = { origin: scene.origin, width: scene.box.width, height: scene.box.height, title: scene.title, target: aiming?.target ?? null, plan: aiming?.plan ?? null, rects: scene.rects, ghost, bar };
  }

  /** The drop, on the real dock (dockview's elements are back as they were); in development the result is checked against the model. */
  private commit(dock: DockviewApi, dragged: Dragged, target: DropTarget, plan: Extract<DropPlan, { ok: true }>): void {
    if (!applyDrop(dock, dragged, target)) return;
    if (this.isDev()) {
      const diff = diffLayouts(plan.layout, dock.toJSON(), 2);
      if (diff.length) console.warn("[dock] the model and dockview disagree about this drop:", diff, { dragged, target });
    }
  }

  /** Puts back what the drag changed in dockview's elements. */
  private reset(scene: Scene): void {
    scene.lifted?.classList.remove(LIFTED);
    this.root()?.removeAttribute(AIMING);
    for (const tabs of scene.tabs.values()) {
      for (const tab of tabs) {
        tab.el.style.transform = "";
        tab.el.style.visibility = "";
      }
    }
  }

  stop(): void {
    this.apply({ type: "end" });
    this.root()?.removeAttribute(AIMING);
    this.view.value = null;
  }
}
