<script setup lang="ts">
// A workspace: the toolbar and the docking area. The docking library
// lays out tabs, groups and splits in this page; each panel's module runs in
// a native view that the main process draws over the panel's content area,
// at the bounds this page reports.
import { ChevronLeft, ChevronRight, LayoutGrid, Plus } from "@lucide/vue";
import {
  DockviewVue,
  type DockviewApi,
  type DockviewGroupPanel,
  type DockviewReadyEvent,
  type VueComponent,
} from "dockview-vue";
import { computed, nextTick, onBeforeUnmount, provide, ref, watch } from "vue";
import type { PanelBounds, SavedLayout } from "../../shared/host-api";
import { keepSlots } from "../../shared/panel-layout";
import { Button } from "@tavora/official-ui/components/ui/button";
import { act, api as host, dialog, dragging, nextPanelSlot, panelsToFront, panelToMaximize, panelToShow, state, tabStep } from "../host";
import { t, templateName } from "../i18n";
import { LAYOUT_TEMPLATES } from "../../shared/layout-templates";
import { fromDockview, groupConstraints, guardDrop, layoutAround, maximizedPanel, panelInfo, placePanel, placeTab, toDockview, type PanelInfo } from "../dock";
import { DockPreview } from "../dock-preview";
import DockPreviewLayer from "../components/workspace/DockPreview.vue";
import WorkspaceIcon from "../components/WorkspaceIcon.vue";
import EmptySlot from "../components/workspace/EmptySlot.vue";
import GroupActions from "../components/workspace/GroupActions.vue";
import HeaderTools from "../components/workspace/HeaderTools.vue";
import TemplatePreview from "../components/workspace/TemplatePreview.vue";
import PanelContent from "../components/workspace/PanelContent.vue";
import PanelTab from "../components/workspace/PanelTab.vue";
import { DOCK } from "../components/workspace/dock-context";
import { outerColumns, type ColumnSide, type DockColumn } from "../dock-columns";
import { pointerLed } from "@tavora/official-ui/components/ui/motion";

/** Space between panel cards and around the dock, in px. */
const GAP = 8;
const THEME = { name: "tavora", className: "dockview-theme-tavora", colorScheme: "dark" as const, gap: GAP };
/** How long the layout must be still before it is saved. */
const SAVE_DELAY_MS = 300;

const view = computed(() => state.value!);
const workspace = computed(() => (view.value.currentWorkspaceId ? view.value.library.workspaces[view.value.currentWorkspaceId] : undefined));

function info(instanceId: string): PanelInfo | undefined {
  return panelInfo(
    view.value.panels.find((item) => item.instanceId === instanceId),
    view.value.modules,
  );
}

// ── Where panels are ───────────────────────────────────────────────────

const elements = new Map<string, HTMLElement>();
const resizes = new ResizeObserver(() => reportSoon());
let dock: DockviewApi | null = null;
let lastReport = "";
let lastArea = "";
let reportFrame = 0;
const columns = ref<DockColumn[]>([]);
let changingColumn = false;
const leftColumn = computed(() => columns.value.find((column) => column.side === "left" && column.hidden));
const rightColumn = computed(() => columns.value.find((column) => column.side === "right" && column.hidden));

function refreshColumns() {
  if (changingColumn) return;
  columns.value = dock && !dock.hasMaximizedGroup() ? outerColumns(dock.toJSON()) : [];
  if (!dock || dock.hasMaximizedGroup()) return;
  const reachable = new Set(columns.value.filter((column) => column.hidden).flatMap((column) => column.groups));
  changingColumn = true;
  try {
    for (const group of dock.groups) {
      if (!group.api.isVisible && !reachable.has(group.id)) group.api.setVisible(true);
    }
  } finally {
    changingColumn = false;
  }
  columns.value = outerColumns(dock.toJSON());
}

function setColumnHidden(side: ColumnSide, hidden: boolean) {
  if (!dock) return;
  const column = outerColumns(dock.toJSON()).find((item) => item.side === side);
  if (!column || (hidden && !column.canCollapse)) return;
  if (hidden && dock.activePanel && column.panels.includes(dock.activePanel.id)) {
    dock.panels.find((panel) => panel.group.api.isVisible && !column.groups.includes(panel.group.id))?.api.setActive();
  }
  changingColumn = true;
  try {
    for (const id of column.groups) dock.getGroup(id)?.api.setVisible(!hidden);
  } finally {
    changingColumn = false;
  }
  refreshColumns();
  if (!hidden) {
    void nextTick(() => {
      const element = root.value?.querySelector<HTMLElement>(".dockview-theme-tavora");
      if (!dock || !element) return;
      dock.layout(element.clientWidth, element.clientHeight);
      dock.getGroup(column.groups[0]!)?.api.setSize({ width: column.width });
      reportSoon();
    });
  }
  reportSoon();
  saveSoon();
}

function columnTitle(column: DockColumn) {
  return [...new Set(column.panels.map((id) => info(id)?.title).filter(Boolean))].join(" · ") || t("workspace.panel");
}

provide(DOCK, {
  info,
  collapseSide(groupId) {
    return columns.value.find((column) => !column.hidden && column.canCollapse && column.groups.includes(groupId))?.side;
  },
  collapseColumn: (side) => setColumnHidden(side, true),
  register(id, element) {
    elements.set(id, element);
    resizes.observe(element);
    reportSoon();
  },
  unregister(id, element) {
    if (elements.get(id) === element) elements.delete(id);
    resizes.unobserve(element);
    reportSoon();
  },
});

/** Tells the main process where each visible panel's content is; once per frame at most. */
function reportSoon() {
  if (reportFrame) return;
  reportFrame = requestAnimationFrame(() => {
    reportFrame = 0;
    const bounds: PanelBounds[] = [];
    for (const [instanceId, element] of elements) {
      const panel = dock?.getPanel(instanceId);
      if (!element.isConnected || !panel?.api.isVisible || !panel.group.api.isVisible) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const maximized = panel.group.api.isMaximized();
      bounds.push({ instanceId, x: rect.left, y: rect.top, width: rect.width, height: rect.height, ...(maximized ? { maximized: true } : {}) });
    }
    reportArea();
    const report = JSON.stringify(bounds);
    if (report === lastReport) return;
    lastReport = report;
    host.setPanelBounds(bounds);
  });
}

/** Tells the main process where the workspace is: its cover goes there while it opens. */
function reportArea() {
  const rect = area.value?.getBoundingClientRect();
  const bounds = rect && rect.width >= 1 && rect.height >= 1 ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null;
  const report = JSON.stringify(bounds);
  if (report === lastArea) return;
  lastArea = report;
  host.setWorkspaceBounds(bounds);
}

// ── Keeping the dock in step with the host ─────────────────────────────

/** True while the dock is changed to match the host, so those changes are not saved back. */
let applying = false;
let appliedEpoch = -1;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function quietly(change: () => void) {
  applying = true;
  try {
    change();
  } finally {
    applying = false;
  }
}

/** Loads the saved layout, then adds panels it lacks and drops panels that are gone. */
function restore(api: DockviewApi) {
  appliedEpoch = view.value.layoutEpoch;
  quietly(() => {
    try {
      load(api, view.value.layout);
    } catch (error) {
      console.error("[tavora] could not restore the layout", error);
      api.clear();
    }
  });
  reconcile(api);
  refreshColumns();
}

/** Puts a whole layout in the dock, its maximized group filling it again. */
function load(api: DockviewApi, layout: SavedLayout | null) {
  if (layout) api.fromJSON(toDockview(layout, info));
  else api.clear();
  const maximized = maximizedPanel(layout);
  const group = maximized ? api.getPanel(maximized)?.group : undefined;
  if (group && api.groups.length > 1) group.api.maximize();
}

/** The panel of the group that fills the workspace, or null. */
function maximizedNow(api: DockviewApi): string | null {
  const group = (api.groups as DockviewGroupPanel[]).find((item) => item.api.isMaximized());
  return group?.activePanel?.id ?? null;
}

function reconcile(api: DockviewApi) {
  const open = new Set(view.value.panels.map((panel) => panel.instanceId));
  let changed = false;
  for (const panel of [...api.panels]) {
    if (!open.has(panel.id)) {
      api.removePanel(panel);
      changed = true;
    }
  }
  if (placeTogether(api, open)) changed = true;
  for (const id of open) {
    if (!api.getPanel(id)) {
      const from = view.value.panels.find((panel) => panel.instanceId === id)?.openedFrom;
      if (!from || !placeTab(api, id, info, from.instanceId, from.background)) {
        placePanel(api, id, info, nextPanelSlot.value);
        nextPanelSlot.value = null;
      }
      changed = true;
    }
  }
  if (api.groups.length && !api.groups.some((group) => group.api.isVisible)) {
    for (const group of api.groups) group.api.setVisible(true);
    changed = true;
  }
  updateConstraints(api);
  refreshColumns();
  if (changed) saveSoon();
}

/**
 * Docks the panels one panels.openMany call opened (their `placement`): around the panel that asked, in the module's
 * panelLayout (dock.ts layoutAround), and the rest where new panels go. The panel that asked keeps the focus. True
 * when it docked any.
 */
function placeTogether(api: DockviewApi, open: Set<string>): boolean {
  const fresh = view.value.panels.filter((panel) => panel.placement && open.has(panel.instanceId) && !api.getPanel(panel.instanceId));
  const plans = new Map(fresh.map((panel) => [panel.placement!.id, panel.placement!]));
  for (const plan of plans.values()) {
    const mine = new Set(fresh.filter((panel) => panel.placement!.id === plan.id).map((panel) => panel.instanceId));
    // Panels that could not open, or were closed since, leave the layout; their neighbours take the room.
    const slots = plan.slots && api.getPanel(plan.anchor) ? keepSlots(plan.slots, (id) => id === plan.anchor || mine.has(id)) : null;
    const saved = slots && !("panel" in slots) ? fromDockview(api.toJSON(), maximizedNow(api)) : null;
    const result = saved && slots ? layoutAround(saved, plan.anchor, slots, info) : null;
    if (result) quietly(() => load(api, result.layout));
    for (const id of mine) if (!api.getPanel(id)) placePanel(api, id, info);
    api.getPanel(plan.anchor)?.api.setActive();
  }
  return fresh.length > 0;
}

/**
 * Gives every group the sizes its panels allow from where it is now, so splits never squeeze one below its
 * minimum and a drag stops where a panel would turn wide (or tall) without room for that layout.
 */
function updateConstraints(api: DockviewApi) {
  for (const group of api.groups as DockviewGroupPanel[]) {
    const next = groupConstraints(group, info);
    if (
      group.minimumWidth !== next.minimumWidth ||
      group.maximumWidth !== next.maximumWidth ||
      group.minimumHeight !== next.minimumHeight ||
      group.maximumHeight !== next.maximumHeight
    ) {
      group.api.setConstraints(next);
    }
  }
}

/** The workspace this page shows: a save that lands after a switch still goes to it, not to the one open by then. */
const pageWorkspaceId = view.value.currentWorkspaceId;

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (dock && pageWorkspaceId) void act({ type: "save-layout", workspaceId: pageWorkspaceId, layout: fromDockview(dock.toJSON(), maximizedNow(dock)) }, { quiet: true });
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

watch(
  () => view.value.panels.map((panel) => panel.instanceId).join(),
  () => dock && reconcile(dock),
);
// Another panel of the module opened this one (panels.open): bring it to the front of its group.
watch(panelToShow, (request) => {
  if (!request || !dock) return;
  panelToShow.value = null;
  const column = columns.value.find((item) => item.hidden && item.panels.includes(request.instanceId));
  if (column) setColumnHidden(column.side, false);
  dock.getPanel(request.instanceId)?.api.setActive();
});
// Ctrl+Tab and Ctrl+Shift+Tab: the next or previous tab of the panel you work in, round at the ends.
watch(tabStep, (request) => {
  if (!request || !dock) return;
  tabStep.value = null;
  const group = dock.activeGroup;
  if (!group || group.panels.length < 2) return;
  const index = group.panels.findIndex((panel) => panel.id === group.activePanel?.id);
  group.panels[(index + request.by + group.panels.length) % group.panels.length]?.api.setActive();
});
// After panels.openMany: the panels that were open already come to the front where they are, and the panel that asked
// keeps the focus. One in that panel's own group stays behind it, so the panel that asked stays the one shown.
watch(panelsToFront, (request) => {
  if (!request || !dock) return;
  panelsToFront.value = null;
  const anchor = dock.getPanel(request.anchor);
  for (const id of request.instanceIds) {
    const panel = dock.getPanel(id);
    if (!panel || panel.group === anchor?.group) continue;
    const column = columns.value.find((item) => item.hidden && item.panels.includes(id));
    if (column) setColumnHidden(column.side, false);
    panel.api.setActive();
  }
  anchor?.api.setActive();
});
// A panel asked to fill the workspace or to go back (panel.setMaximized), as Maximize and Restore in its menu do.
watch(panelToMaximize, (request) => {
  if (!request || !dock) return;
  panelToMaximize.value = null;
  const panel = dock.getPanel(request.instanceId);
  if (!panel) return;
  const group = panel.group;
  if (!request.maximized) {
    if (group.api.isMaximized()) group.api.exitMaximized();
    return;
  }
  panel.api.setActive();
  if (!group.api.isMaximized() && dock.groups.length > 1) group.api.maximize();
});
watch(
  () => view.value.layoutEpoch,
  (epoch) => dock && epoch !== appliedEpoch && restore(dock),
);

// ── Drags ──────────────────────────────────────────────────────────────

// While something is dragged or a split is resized, module views are
// hidden: they are drawn above this page and would swallow the pointer.
// A drag ends with dragend or drop; a resize with pointerup. Chromium sends
// pointercancel when a drag starts, so that only ends a resize.
function endDrag() {
  dragging.value = null;
}

// ── The drop preview ───────────────────────────────────────────────────

// While a panel is dragged over the dock, dock-preview.ts shows where it lands and does the drop itself, through
// dockview's own API. Dockview's overlays never show: its drop events do not get past the preview.
const preview = new DockPreview(
  () => dock,
  () => root.value,
  info,
  endDrag,
  () => !!state.value?.devBuild,
);
function endResize() {
  if (dragging.value === "resize") endDrag();
}
addEventListener("dragend", endDrag, true);
addEventListener("drop", endDrag, true);
addEventListener("pointerup", endDrag, true);
addEventListener("pointercancel", endResize, true);
addEventListener("resize", reportSoon);
preview.attach();

function onPointerDown(event: PointerEvent) {
  if (!(event.target as Element | null)?.closest(".dv-sash")) return;
  dragging.value = "resize";
}

function onReady({ api }: DockviewReadyEvent) {
  dock = api;
  restore(api);
  api.onDidLayoutChange(() => {
    // Sizes changed, so what each group may be dragged to next changed too.
    updateConstraints(api);
    refreshColumns();
    reportSoon();
    if (!applying) saveSoon();
  });
  api.onDidAddGroup(() => updateConstraints(api));
  api.onDidMovePanel(() => updateConstraints(api));
  api.onDidActivePanelChange(({ panel }) => {
    if (!applying && panel) {
      const column = outerColumns(api.toJSON()).find((item) => item.hidden && item.panels.includes(panel.id));
      if (column) setColumnHidden(column.side, false);
    }
    updateConstraints(api);
    reportSoon();
  });
  // The group the user works in is saved, so new panels still go there after a restart.
  api.onDidActiveGroupChange(() => {
    if (!applying) saveSoon();
  });
  api.onDidMaximizedGroupChange(() => {
    refreshColumns();
    reportSoon();
    if (!applying) saveSoon();
  });
  api.onWillDragPanel(() => (dragging.value = "panel"));
  api.onWillDragGroup(() => (dragging.value = "panel"));
  api.onWillDrop((event) => guardDrop(event, api, info));
  api.onDidDrop(() => endDrag());
}

const root = ref<HTMLElement | null>(null);
/** The room the panels share, where the loading card and the host's cover go. */
const area = ref<HTMLElement | null>(null);
watch([root, area], (elements, previous) => {
  for (const element of previous ?? []) if (element) resizes.unobserve(element);
  for (const element of elements) if (element) resizes.observe(element);
});

onBeforeUnmount(() => {
  // A change made just before a switch is still saved, into this page's own workspace.
  if (saveTimer !== undefined) saveNow();
  cancelAnimationFrame(reportFrame);
  resizes.disconnect();
  removeEventListener("dragend", endDrag, true);
  removeEventListener("drop", endDrag, true);
  removeEventListener("pointerup", endDrag, true);
  removeEventListener("pointercancel", endResize, true);
  removeEventListener("resize", reportSoon);
  preview.detach();
  endDrag();
  host.setPanelBounds([]);
  host.setWorkspaceBounds(null);
});

// The library types components loosely; these take its documented props.
// A workspace picked with the pointer fades in over ~120ms (opacity only; the old one is already gone). A key press, a
// hotkey or the app starting on its last workspace stays instant (Ctrl+K is a key too). Reduced motion keeps it as a plain fade. The page is made new for each workspace anyway, so
// this adds no remount; the module pages are the host's own views and are not touched.
const arrival = pointerLed() ? "tavora-quick-fade" : undefined;
const components = { panel: PanelContent as unknown as VueComponent };
const tab = PanelTab as unknown as VueComponent;
const groupActions = GroupActions as unknown as VueComponent;
const emptySlot = EmptySlot as unknown as VueComponent;
</script>

<template>
  <main :class="['workspace-canvas flex h-full min-w-0 flex-col', arrival]" data-testid="workspace">
    <!-- pl-6 leaves room for the rail's round expand button, which hangs over the rail's edge. -->
    <header class="app-drag flex h-14 flex-none items-center gap-3 pr-[calc(100vw-env(titlebar-area-x,0px)-env(titlebar-area-width,100vw)+0.5rem)] pl-6">
      <WorkspaceIcon v-if="workspace" :workspace="workspace" :size="32" />
      <h1 class="max-w-72 min-w-0 truncate text-lg font-semibold">{{ workspace?.name }}</h1>
      <!-- While this workspace's game runs. Overlays have their own Start / Stop on the right. -->
      <span
        v-if="view.workspaceRunning"
        class="text-success border-success/40 bg-success/10 flex flex-none items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
        :title="t('rail.running', { name: workspace?.name ?? '' })"
        data-testid="workspace-running"
      >
        <span class="bg-success size-1.5 rounded-full" aria-hidden="true" />
        {{ t("workspace.running") }}
      </span>
      <span class="text-info ml-auto min-w-0 truncate text-sm" role="status" data-testid="notice">{{ view.notice ?? "" }}</span>
      <HeaderTools @add-module="dialog = { kind: 'add-module' }" />
    </header>

    <div ref="root" class="relative min-h-0 flex-1" @pointerdown.capture="onPointerDown">
      <div ref="area" class="absolute inset-x-2 top-0 bottom-2 flex gap-2" data-workspace-area>
        <Button
          v-if="leftColumn"
          variant="secondary"
          class="h-full w-7 flex-none flex-col justify-start gap-3 overflow-hidden rounded-lg border px-0 py-3"
          :aria-label="t('dock.showLeftColumn')"
          :title="`${t('dock.showLeftColumn')}: ${columnTitle(leftColumn)}`"
          data-testid="show-left-column"
          @click="setColumnHidden('left', false)"
        >
          <ChevronRight class="size-4 flex-none" aria-hidden="true" />
          <span class="max-h-[70%] truncate text-xs [writing-mode:vertical-rl]">{{ columnTitle(leftColumn) }}</span>
        </Button>
        <DockviewVue
          class="min-w-0 flex-1"
          :theme="THEME"
          :components="components"
          :default-tab-component="tab"
          :right-header-actions-component="groupActions"
          :watermark-component="emptySlot"
          :disable-floating-groups="true"
          dnd-strategy="html5"
                    @ready="onReady"
        />
        <Button
          v-if="rightColumn"
          variant="secondary"
          class="h-full w-7 flex-none flex-col justify-start gap-3 overflow-hidden rounded-lg border px-0 py-3"
          :aria-label="t('dock.showRightColumn')"
          :title="`${t('dock.showRightColumn')}: ${columnTitle(rightColumn)}`"
          data-testid="show-right-column"
          @click="setColumnHidden('right', false)"
        >
          <ChevronLeft class="size-4 flex-none" aria-hidden="true" />
          <span class="max-h-[70%] truncate text-xs [writing-mode:vertical-rl]">{{ columnTitle(rightColumn) }}</span>
        </Button>
      </div>
      <DockPreviewLayer v-if="preview.view.value" :preview="preview.view.value" />
      <!-- The workspace just opened: one plain card over the dock until every panel has its data. The host's cover lies over it
           until every panel has drawn, and shows the fire when opening takes long (panel-cover.ts). -->
      <div v-if="view.opening" class="bg-background absolute inset-x-2 top-0 bottom-2 z-20 rounded-[10px] border" role="status" :aria-label="t('panel.loading', { name: workspace?.name ?? '' })" data-testid="workspace-loading"></div>
      <div
        v-if="!view.panels.length && !view.layout"
        class="bg-background absolute inset-x-2 top-0 bottom-2 z-10 flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed text-center"
        data-testid="empty-workspace"
      >
        <LayoutGrid class="text-muted-foreground mb-2 size-12" :stroke-width="1" />
        <p class="text-lg font-semibold">{{ t("workspace.startTitle") }}</p>
        <p class="text-muted-foreground max-w-sm text-sm">{{ t("workspace.startText") }}</p>
        <Button class="mt-3 h-9 text-sm [&_svg]:size-5" data-testid="empty-add-module" @click="dialog = { kind: 'add-module' }">
          <Plus :stroke-width="2" absolute-stroke-width /> {{ t("workspace.addModule") }}
        </Button>
        <!-- The quiet way in: the six presets. Even grids live in the Layouts menu only. -->
        <p class="text-muted-foreground mt-6 text-xs" id="empty-layouts-label">{{ t("workspace.orLayout") }}</p>
        <div class="flex flex-wrap justify-center gap-2" role="group" aria-labelledby="empty-layouts-label" data-testid="empty-templates">
          <button
            v-for="template in LAYOUT_TEMPLATES"
            :key="template.id"
            type="button"
            class="text-muted-foreground hover:border-primary hover:text-primary focus-visible:ring-ring rounded-lg border p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            :title="templateName(template)"
            :aria-label="templateName(template)"
            :data-testid="`empty-template-${template.id}`"
            @click="act({ type: 'apply-layout-template', templateId: template.id })"
          >
            <TemplatePreview :template="template" class="size-auto h-14 w-[84px]" />
          </button>
        </div>
      </div>
    </div>
  </main>
</template>
