// The drop preview while a panel is dragged: nothing moves. The dragged panel's group fades, and a rectangle from the
// layout model (dock-model.ts) shows where it will land. This file reads the dock's DOM once when the drag starts, aims
// with dock-aim.ts, asks the model, and sets the few things that live in dockview's own elements (the fade, the tabs
// that make room). DockPreview.vue draws the rest. The drag's steps are dock-drag.ts.
//
// The keyboard moves a panel the same way: Ctrl+M on its tab lifts it, the arrow keys (and Tab) step through the places
// the pointer can aim at (dock-aim.ts `spots`), Enter drops and Escape cancels. `said` is what a screen reader hears.
import { getPanelData, type DockviewApi, type DockviewGroupPanel } from "dockview-vue";
import { shallowRef } from "vue";
import { aimAt, sameTarget, spots, stepToward, type Slot, type Spot } from "./dock-aim";
import { applyDrop } from "./dock-drop";
import { dockDragStep, type DockDrag, type DockDragEvent, type DockDragStep, type DragBy } from "./dock-drag";
import { diffLayouts, planDrop, type Dragged, type DropPlan, type DropTarget, type Rect, type Side } from "./dock-model";
import type { PanelInfo } from "./dock";
import { t } from "./i18n";
import { MAC } from "./shortcuts";

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
  /** Every place to aim at, for the keyboard (a pointer drag needs none). */
  spots: Spot[];
  /** What each group is called when a place is read out: its shown panel (not the dragged one). */
  names: Record<string, string>;
}

type Moving = Exclude<DockDrag<Scene>, { phase: "idle" }>;

const LIFTED = "dock-lifted";
const AIMING = "data-dock-aiming";
/** On the root while the keyboard moves a panel: nothing a key starts animates (dock.css). */
const KEYBOARD = "data-dock-keyboard";
const ARROWS: Record<string, Side> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" };

/** Ctrl+M (Cmd+M on a Mac): lifts the focused tab's panel. */
const isMoveKey = (event: KeyboardEvent): boolean =>
  event.key.toLowerCase() === "m" && !event.altKey && !event.shiftKey && (MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

/** A place read out: the dock's edge, beside a group, or a tab's place in a group. */
function describe(target: DropTarget, scene: Scene): string {
  if (target.kind === "edge") return t(`dock.move.edge.${target.side}`);
  const group = scene.names[target.group] ?? "";
  if (target.kind === "split") return t(`dock.move.split.${target.side}`, { group });
  const others = scene.slots[target.group]?.length ?? 0;
  return t("dock.move.tab", { place: (target.index ?? others) + 1, count: others + 1, group });
}
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
    /** A keyboard move started (a pointer drag tells the page itself, through dockview). */
    private readonly onLift: () => void,
    private readonly onDone: () => void,
    private readonly isDev: () => boolean,
  ) {}

  /** What a screen reader hears of a keyboard move (a live region in WorkspacePage.vue). */
  readonly said = shallowRef("");

  get active(): boolean {
    return this.drag.phase !== "idle";
  }

  private get by(): DragBy | null {
    return this.drag.phase === "idle" ? null : this.drag.by;
  }

  /** Dragover and drop go through here first; true when this is the dock's drop and dockview must not see it. */
  private readonly onOver = (event: DragEvent) => {
    // Something dragged in from outside (a file) while the keyboard moves a panel is none of the move's business.
    if (this.by === "keyboard") return;
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
    if (this.by === "keyboard" || !this.take(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  private readonly onDrop = (event: DragEvent) => {
    if (this.by === "keyboard" || !this.take(event)) return;
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
    if (this.by !== "pointer") return;
    this.apply({ type: "end" });
    this.onDone();
  };

  /** After dockview's own handler, so its picture of the tab (which would show a second copy next to ours) is replaced. */
  private readonly onStart = (event: DragEvent) => {
    if (getPanelData()) event.dataTransfer?.setDragImage(NO_IMAGE, 0, 0);
  };

  /**
   * Before dockview's own keys on a tab (the arrows move the focus, Enter shows the tab, Delete closes it): Ctrl+M lifts
   * the focused tab's panel, and while the keyboard moves it every key is the move's.
   */
  private readonly onKey = (event: KeyboardEvent) => {
    const by = this.by;
    if (by === null && isMoveKey(event)) {
      const tab = event.target instanceof Element ? event.target.closest<HTMLElement>(".dv-tab") : null;
      const panelId = tab?.dataset.tabPanelId;
      if (!tab || !panelId || !this.root()?.contains(tab)) return;
      event.preventDefault();
      event.stopPropagation();
      this.lift(panelId);
      return;
    }
    if (by !== "keyboard") return;
    event.preventDefault();
    event.stopPropagation();
    const side = ARROWS[event.key];
    if (side) this.aimByKey((all, at) => (at < 0 ? all[0] : stepToward(all, all[at]!, side)));
    else if (event.key === "Tab") this.aimByKey((all, at) => all[(at + (event.shiftKey ? -1 : 1) + all.length) % all.length]);
    else if (event.key === "Enter" && !event.repeat) this.letGo("drop");
    else if (event.key === "Escape") this.letGo("end");
  };
  /** A keyboard move ends without a change when the focus leaves its tab (a dialog opened, the window lost it), on a click, and when the window resizes. */
  private readonly onInterrupt = () => {
    if (this.by === "keyboard") this.letGo("end");
  };

  attach(): void {
    addEventListener("dragstart", this.onStart);
    addEventListener("dragenter", this.onEnter, true);
    addEventListener("dragover", this.onOver, true);
    addEventListener("drop", this.onDrop, true);
    addEventListener("dragend", this.onEnd, true);
    addEventListener("keydown", this.onKey, true);
    addEventListener("focusout", this.onInterrupt, true);
    addEventListener("pointerdown", this.onInterrupt, true);
    addEventListener("resize", this.onInterrupt);
  }
  detach(): void {
    removeEventListener("dragstart", this.onStart);
    removeEventListener("dragenter", this.onEnter, true);
    removeEventListener("dragover", this.onOver, true);
    removeEventListener("drop", this.onDrop, true);
    removeEventListener("dragend", this.onEnd, true);
    removeEventListener("keydown", this.onKey, true);
    removeEventListener("focusout", this.onInterrupt, true);
    removeEventListener("pointerdown", this.onInterrupt, true);
    removeEventListener("resize", this.onInterrupt);
    this.stop();
  }

  /** Lifts a panel for the keyboard, aimed at where it is now. */
  private lift(panelId: string): void {
    const dock = this.dock();
    const root = this.root();
    const dockEl = root?.querySelector<HTMLElement>(".dv-dockview");
    const group = dock?.getPanel(panelId)?.group;
    if (!dock || !root || !dockEl || !group) return;
    this.start(dock, root, dockEl, { groupId: group.id, panelId }, "keyboard");
    if (this.drag.phase === "idle") return;
    const { scene } = this.drag;
    const index = scene.tabs.get(group.id)?.findIndex((tab) => tab.dragged) ?? -1;
    const here = scene.spots.find((spot) => sameTarget(spot.target, { kind: "tab", group: group.id, index })) ?? scene.spots.find((spot) => spot.target.kind === "tab" && spot.target.group === group.id);
    this.onLift();
    if (here) this.setTarget(here.target);
    this.said.value = t("dock.move.start", { name: scene.title });
  }

  /** An arrow key or Tab: aims at the place `pick` chooses (from the index of the one aimed at now), and reads it out. */
  private aimByKey(pick: (all: readonly Spot[], at: number) => Spot | null | undefined): void {
    const drag = this.drag;
    if (drag.phase === "idle") return;
    const all = drag.scene.spots;
    const next = pick(all, drag.phase === "aiming" ? all.findIndex((spot) => sameTarget(spot.target, drag.target)) : -1);
    if (!next) return;
    this.setTarget(next.target);
    if (this.drag.phase !== "aiming") return;
    const { target, plan, scene } = this.drag;
    const place = describe(target, scene);
    this.said.value = plan.ok ? place : plan.reason === "too-small" ? t("dock.move.noRoom", { place }) : plan.reason === "same-spot" ? t("dock.move.samePlace", { place }) : place;
  }

  /** Enter drops where the keyboard aims; Escape, or the move being interrupted, leaves everything as it was. */
  private letGo(type: "drop" | "end"): void {
    if (this.drag.phase === "idle") return;
    const name = this.drag.scene.title;
    const panelId = this.drag.dragged.panelId;
    const { drop } = this.apply({ type });
    const dock = this.dock();
    const moved = !!dock && !!drop && this.commit(dock, drop.dragged, drop.target, drop.plan);
    this.said.value = moved ? t("dock.move.moved", { name }) : type === "drop" ? t("dock.move.stays", { name }) : t("dock.move.canceled", { name });
    this.onDone();
    // Dockview draws the moved tab anew: the focus goes with it.
    if (moved && panelId) requestAnimationFrame(() => this.root()?.querySelector<HTMLElement>(`.dv-tab[data-tab-panel-id="${CSS.escape(panelId)}"]`)?.focus());
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

  private start(dock: DockviewApi, root: HTMLElement, dockEl: HTMLElement, dragged: Dragged, by: DragBy = "pointer"): void {
    const box = dockEl.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    const rects: Scene["rects"] = {};
    const tabsOf: Scene["tabs"] = new Map();
    const slotsOf: Scene["slots"] = {};
    const stripEnd: Scene["stripEnd"] = {};
    const stripStart: Scene["stripStart"] = {};
    const names: Scene["names"] = {};
    for (const group of dock.groups as DockviewGroupPanel[]) {
      if (!group.api.isVisible) continue;
      const shown = [group.activePanel, ...group.panels].find((panel) => panel && panel.id !== dragged.panelId) ?? group.activePanel;
      names[group.id] = (shown && this.info(shown.id)?.title) || "";
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
      spots: by === "keyboard" ? spots({ width: box.width, height: box.height, rects, slots: slotsOf }) : [],
      names,
    };
    this.apply({ type: "start", by, dragged, scene });
    scene.lifted?.classList.add(LIFTED);
    // The keyboard's tab keeps the focus, which a hidden element can't: it only turns see-through.
    if (own && by === "keyboard") own.el.style.opacity = "0";
    else if (own) own.el.style.visibility = "hidden";
    root.setAttribute(AIMING, "");
    if (by === "keyboard") root.setAttribute(KEYBOARD, "");
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
  private commit(dock: DockviewApi, dragged: Dragged, target: DropTarget, plan: Extract<DropPlan, { ok: true }>): boolean {
    if (!applyDrop(dock, dragged, target)) return false;
    if (this.isDev()) {
      const diff = diffLayouts(plan.layout, dock.toJSON(), 2);
      if (diff.length) console.warn("[dock] the model and dockview disagree about this drop:", diff, { dragged, target });
    }
    return true;
  }

  /** Puts back what the drag changed in dockview's elements. */
  private reset(scene: Scene): void {
    scene.lifted?.classList.remove(LIFTED);
    const root = this.root();
    root?.removeAttribute(AIMING);
    for (const tabs of scene.tabs.values()) {
      for (const tab of tabs) {
        tab.el.style.transform = "";
        tab.el.style.visibility = "";
        tab.el.style.opacity = "";
      }
    }
    if (!root?.hasAttribute(KEYBOARD)) return;
    // The page takes on the group's and the tabs' way back while nothing animates (dock.css), then animates again.
    void root.offsetWidth;
    root.removeAttribute(KEYBOARD);
  }

  stop(): void {
    this.apply({ type: "end" });
    this.root()?.removeAttribute(AIMING);
    this.view.value = null;
  }
}
