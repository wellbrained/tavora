// Runs in the bare window of dock-model.spec.ts: builds the real dock for a layout, makes each drop with the real
// dockview, and says where the model (dock-model.ts) differs from what dockview did.
import { createDockview, type DockviewApi, type DockviewGroupPanel } from "dockview-vue";
import "../../../src/renderer/dock.css";
import { groupConstraints, toDockview, type PanelInfo } from "../../../src/renderer/dock";
import { applyDrop } from "../../../src/renderer/dock-drop";
import { diffLayouts, DOCK_GAP, NEW_GROUP, planDrop, groupRects, type Dragged, type DropTarget } from "../../../src/renderer/dock-model";
import type { SavedLayout } from "../../../src/shared/host-api";

export interface Case {
  dragged: Dragged;
  target: DropTarget;
}
export interface Spec {
  layout: SavedLayout;
  infos: Record<string, PanelInfo>;
  cases: Case[];
}
export interface Report {
  case: Case;
  outcome: "same" | "refused" | "mismatch" | "refused-but-live-works";
  detail?: string | undefined;
  reason?: string | undefined;
}

const host = document.getElementById("host")!;

function build(spec: Spec): DockviewApi {
  host.replaceChildren();
  const element = document.createElement("div");
  element.style.cssText = `width:${spec.layout.width}px;height:${spec.layout.height}px;position:relative`;
  host.appendChild(element);
  const api = createDockview(element, {
    createComponent: () => ({ element: document.createElement("div"), init() {} }),
    theme: { name: "tavora", className: "dockview-theme-tavora", gap: DOCK_GAP },
    disableFloatingGroups: true,
    dndStrategy: "html5",
  } as never);
  const info = (id: string) => spec.infos[id];
  const update = () => {
    for (const group of api.groups as DockviewGroupPanel[]) {
      const next = groupConstraints(group, info);
      if (group.minimumWidth !== next.minimumWidth || group.maximumWidth !== next.maximumWidth || group.minimumHeight !== next.minimumHeight || group.maximumHeight !== next.maximumHeight) group.api.setConstraints(next);
    }
  };
  api.layout(spec.layout.width, spec.layout.height);
  api.fromJSON(toDockview(spec.layout, info));
  api.layout(spec.layout.width, spec.layout.height);
  update();
  // The same listeners WorkspacePage.vue has.
  api.onDidLayoutChange(update);
  api.onDidAddGroup(update);
  api.onDidMovePanel(update);
  api.onDidActivePanelChange(update);
  return api;
}

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

type Node = { type: string; size?: number; visible?: boolean; data: unknown };

function run(spec: Spec, entry: Case): Report {
  const api = build(spec);
  const before = api.toJSON();
  const plan = planDrop(before, entry.dragged, entry.target, (id) => spec.infos[id]);
  const rectsBefore = groupRects(before);
  const oldIds = new Set(api.groups.map((group) => group.id));
  const live = (): Record<string, DOMRect> => Object.fromEntries(api.groups.filter((group) => group.api.isVisible).map((group) => [group.id, group.element.getBoundingClientRect()]));
  // The dock's own rectangles must match the model's before anything moves.
  const origin = api.groups[0]?.element.closest(".dv-dockview")?.getBoundingClientRect();
  const out: string[] = [];
  if (origin)
    for (const [id, rect] of Object.entries(live())) {
      const mine = rectsBefore[id];
      if (!mine || !near(mine.x, rect.left - origin.left, 1.5) || !near(mine.y, rect.top - origin.top, 1.5) || !near(mine.width, rect.width, 1.5) || !near(mine.height, rect.height, 1.5)) out.push(`before: ${id} model ${JSON.stringify(mine)} vs dockview ${rect.left - origin.left},${rect.top - origin.top} ${rect.width}x${rect.height}`);
    }
  if (!plan.ok) {
    if (plan.reason === "same-spot" && entry.target.kind === "split") {
      // Nothing may change when the model says so.
      try {
        applyDrop(api, entry.dragged, entry.target);
        const kept = diffLayouts(before, api.toJSON());
        out.push(...kept.map((line) => `same-spot but dockview changed: ${line}`));
      } catch {
        // dockview refuses to move a group onto itself, which is the same: nothing changes.
      }
    }
    return { case: entry, outcome: out.length ? "mismatch" : "refused", reason: plan.reason, detail: out.join("; ") || undefined };
  }
  applyDrop(api, entry.dragged, entry.target);
  const after = api.toJSON();
  out.push(...diffLayouts(plan.layout, after));
  const fresh = api.groups.find((group) => !oldIds.has(group.id));
  const real = origin ? live() : {};
  for (const [id, mine] of Object.entries(plan.rects)) {
    const realId = id === NEW_GROUP ? fresh?.id : id;
    const rect = realId ? real[realId] : undefined;
    if (!rect || !origin) out.push(`rect: ${id} missing in dockview`);
    else if (!near(mine.x, rect.left - origin.left, 1.5) || !near(mine.y, rect.top - origin.top, 1.5) || !near(mine.width, rect.width, 1.5) || !near(mine.height, rect.height, 1.5)) out.push(`rect ${id}: model ${Math.round(mine.x)},${Math.round(mine.y)} ${Math.round(mine.width)}x${Math.round(mine.height)} vs dockview ${Math.round(rect.left - origin.left)},${Math.round(rect.top - origin.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
  }
  return { case: entry, outcome: out.length ? "mismatch" : "same", detail: out.join("; ") || undefined };
}

(window as unknown as { compare: (spec: Spec) => Report[] }).compare = (spec) => spec.cases.map((entry) => run(spec, entry));
(window as unknown as { dump: (spec: Spec) => unknown }).dump = (spec) => {
  const api = build(spec);
  return { json: api.toJSON(), w: api.width, h: api.height, rects: api.groups.map((g) => [g.id, g.element.getBoundingClientRect().toJSON(), g.width, g.height]), dock: document.querySelector(".dv-dockview")?.getBoundingClientRect().toJSON() };
};
