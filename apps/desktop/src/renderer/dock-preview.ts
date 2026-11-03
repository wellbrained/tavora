// The drop preview while a panel is dragged: nothing moves. The dragged panel's group fades, and a rectangle from the
// layout model (dock-model.ts) shows where it will land. This file reads the dock's DOM once when the drag starts, aims
// with dock-aim.ts, asks the model, and sets the few things that live in dockview's own elements (the fade, the tabs
// that make room). DockPreview.vue draws the rest.
import { getPanelData, type DockviewApi, type DockviewGroupPanel } from "dockview-vue";
import { shallowRef } from "vue";
import { aimAt, type Slot } from "./dock-aim";
import { aimDrag, dropDrag, NO_DRAG, startDrag, type DragSession, type Drop } from "./dock-drag";
import { applyDrop } from "./dock-drop";
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

const LIFTED = "dock-lifted";
const AIMING = "data-dock-aiming";
const GHOST_GAP = 4;
/** The narrowest dashed tab worth showing; with less room the ghost is a bar. */
const MIN_GHOST = 56;
const BAR = 4;
/** A drag image nobody can see: our preview is the only picture of what is dragged. */
const NO_IMAGE = Object.assign(new Image(1, 1), { src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" });

/** What the dock looked like when the drag started; read once, kept for that drag only. */
interface Measured {
  /** The dock's box in the window. */
  box: DOMRect;
  /** Where the dock sits inside the preview's layer. */
  origin: { x: number; y: number };
  title: string;
  tabs: Map<string, Tab[]>;
  slots: Record<string, Slot[]>;
  /** Where each group's tab row ends (its tabs are clipped there), in the dock's coordinates. */
  stripEnd: Record<string, number>;
  stripStart: Record<string, number>;
  rects: Record<string, Rect>;
  tabWidth: number;
  /** The dragged panel's group, faded. */
  lifted: HTMLElement | null;
}

type Aiming = Extract<DragSession<Measured>, { phase: "aiming" }>;

export class DockPreview {
  readonly view = shallowRef<PreviewView | null>(null);
  /** The drag being aimed, with everything that belongs to it (dock-drag.ts). */
  private session: DragSession<Measured> = NO_DRAG;

  constructor(
    private readonly dock: () => DockviewApi | null,
    private readonly root: () => HTMLElement | null,
    private readonly info: (id: string) => PanelInfo | undefined,
    private readonly onDone: () => void,
    private readonly isDev: () => boolean,
  ) {}

  get active(): boolean {
    return this.session.phase === "aiming";
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
    const plan = this.session.phase === "aiming" ? this.session.plan : null;
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
    const dock = this.dock();
    const drop = dropDrag(this.session);
    if (dock && drop) this.commit(dock, drop);
    this.stop();
    this.onDone();
  };
  /** The drag ended without a drop on the dock: Escape, or let go somewhere else (outside the window too). */
  private readonly onEnd = () => {
    if (!this.active) return;
    this.stop();
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

  /** Starts on the first drag event of a panel or group drag over the dock; false for anything else. */
  private take(event: DragEvent): boolean {
    const data = getPanelData();
    const dock = this.dock();
    const root = this.root();
    const dockEl = root?.querySelector<HTMLElement>(".dv-dockview");
    if (!data || !dock || !root || !dockEl) return false;
    if (!this.active) this.start(dock, root, dockEl, { groupId: data.groupId, panelId: data.panelId });
    if (this.session.phase !== "aiming") return false;
    const box = this.session.measured.box;
    return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  }

  private start(dock: DockviewApi, root: HTMLElement, dockEl: HTMLElement, dragged: Dragged): void {
    const box = dockEl.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    const rects: Record<string, Rect> = {};
    const allTabs = new Map<string, Tab[]>();
    const allSlots: Record<string, Slot[]> = {};
    const stripEnd: Record<string, number> = {};
    const stripStart: Record<string, number> = {};
    for (const group of dock.groups as DockviewGroupPanel[]) {
      if (!group.api.isVisible) continue;
      const r = group.element.getBoundingClientRect();
      rects[group.id] = { x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height };
      const tabs: Tab[] = [...group.element.querySelectorAll<HTMLElement>(".dv-tab")].map((el) => {
        const t = el.getBoundingClientRect();
        return { el, left: t.left - box.left, width: t.width, dragged: !!dragged.panelId && !!el.querySelector(`[data-testid="panel-${dragged.panelId}"]`) };
      });
      allTabs.set(group.id, tabs);
      // The tabs that stay, where they sit once the dragged one is gone.
      let shift = 0;
      const slots: Slot[] = [];
      for (const tab of tabs) {
        if (tab.dragged) shift = tab.width;
        else slots.push({ left: tab.left - shift, width: tab.width });
      }
      allSlots[group.id] = slots;
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
    const own = allTabs.get(dragged.groupId)?.find((tab) => tab.dragged);
    const lifted = source?.element ?? null;
    lifted?.classList.add(LIFTED);
    if (own) own.el.style.visibility = "hidden";
    root.setAttribute(AIMING, "");
    const panel = dragged.panelId ?? source?.activePanel?.id ?? source?.panels[0]?.id;
    const session = startDrag(dragged, dock.toJSON(), {
      box,
      origin: { x: box.left - rootBox.left, y: box.top - rootBox.top },
      title: (panel && this.info(panel)?.title) || "",
      tabs: allTabs,
      slots: allSlots,
      stripEnd,
      stripStart,
      rects,
      tabWidth: own?.width ?? allTabs.get(dragged.groupId)?.[0]?.width ?? 140,
      lifted,
    });
    this.session = session;
    this.publish(session);
  }

  private aim(clientX: number, clientY: number): void {
    if (this.session.phase !== "aiming") return;
    const { box, rects, slots } = this.session.measured;
    this.setTarget(aimAt({ width: box.width, height: box.height, rects, slots }, clientX - box.left, clientY - box.top));
  }

  private setTarget(target: DropTarget | null): void {
    const next = aimDrag(this.session, target, (layout, dragged, aimed) => planDrop(layout, dragged, aimed, this.info));
    if (next === this.session || next.phase !== "aiming") return;
    this.session = next;
    this.slide(next);
    this.publish(next);
  }

  /**
   * How a tab slot opens in a group's strip: the dashed tab's width and how far the tabs after the slot move. The strip
   * clips its tabs, so the gap is only as wide as the room left at its end; with less than a small tab's worth the
   * ghost is a bar and nothing moves, so no tab is ever pushed out of sight.
   */
  private gap(measured: Measured, group: string, index: number): { width: number; shift: number; bar: boolean } {
    const slots = measured.slots[group] ?? [];
    const last = slots.at(-1);
    const end = last ? last.left + last.width : (measured.rects[group]?.x ?? 0);
    const room = (measured.stripEnd[group] ?? Infinity) - end - GHOST_GAP;
    const width = Math.min(measured.tabWidth, room);
    if (width < MIN_GHOST) return { width: BAR, shift: 0, bar: true };
    void index;
    return { width, shift: width + GHOST_GAP, bar: false };
  }

  /** The tabs of the group aimed at make room for the dashed one. */
  private slide({ target, plan, measured }: Aiming): void {
    const into = target?.kind === "tab" && plan?.ok ? target.group : null;
    const index = into && target?.kind === "tab" ? (target.index ?? measured.slots[into]?.length ?? 0) : 0;
    const open = into ? this.gap(measured, into, index).shift : 0;
    for (const [group, tabs] of measured.tabs) {
      if (group !== into && !tabs.some((tab) => tab.el.style.transform)) continue;
      let remaining = 0;
      let shift = 0;
      for (const tab of tabs) {
        if (tab.dragged) {
          shift = tab.width;
          continue;
        }
        tab.el.style.transform = group === into ? `translateX(${(remaining >= index ? open : 0) - shift}px)` : "";
        remaining++;
      }
    }
  }

  private publish({ target, plan, measured }: Aiming): void {
    const { box } = measured;
    let ghost: Rect | null = null;
    let bar = false;
    if (target?.kind === "tab" && plan?.ok) {
      const rect = measured.rects[target.group];
      const slots = measured.slots[target.group] ?? [];
      const index = target.index ?? slots.length;
      const last = slots.at(-1);
      const slotX = index < slots.length ? slots[index]!.left : last ? last.left + last.width + GHOST_GAP : (rect?.x ?? 0) + 6;
      // A tab row that scrolls can have its slot out of sight: the ghost stays inside the visible part of the row.
      const x = Math.max(slotX, measured.stripStart[target.group] ?? slotX);
      const gap = this.gap(measured, target.group, index);
      bar = gap.bar;
      if (rect) {
        // A bar sits on the line between two tabs, and inside the first or last tab at the ends, clear of the group's outline.
        const at = index === 0 ? x + 3 : index >= slots.length ? x - GHOST_GAP - BAR - 3 : x - BAR / 2 - GHOST_GAP / 2;
        ghost = bar ? { x: at, y: rect.y + 3, width: BAR, height: 30 } : { x, y: rect.y + 4, width: gap.width, height: 28 };
      }
    }
    this.view.value = { origin: measured.origin, width: box.width, height: box.height, title: measured.title, target, plan, rects: measured.rects, ghost, bar };
  }

  /** The drop, on the real dock; in development the result is checked against the model. */
  private commit(dock: DockviewApi, { dragged, target, plan }: Drop): void {
    this.reset();
    if (!applyDrop(dock, dragged, target)) return;
    if (this.isDev()) {
      const diff = diffLayouts(plan.layout, dock.toJSON(), 2);
      if (diff.length) console.warn("[dock] the model and dockview disagree about this drop:", diff, { dragged, target });
    }
  }

  /** Puts back what the drag changed in dockview's own elements. */
  private reset(): void {
    this.root()?.removeAttribute(AIMING);
    if (this.session.phase !== "aiming") return;
    const { measured } = this.session;
    measured.lifted?.classList.remove(LIFTED);
    for (const tabs of measured.tabs.values()) {
      for (const tab of tabs) {
        tab.el.style.transform = "";
        tab.el.style.visibility = "";
      }
    }
  }

  stop(): void {
    this.reset();
    this.session = NO_DRAG;
    this.view.value = null;
  }
}
