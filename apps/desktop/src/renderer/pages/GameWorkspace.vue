<script setup lang="ts">
// A game's workspace: the toolbar and the docking area. The docking library
// lays out tabs, groups and splits in this page; each panel's module runs in
// a native view that the main process draws over the panel's content area,
// at the bounds this page reports.
import { LayoutGrid, Plus } from "@lucide/vue";
import {
  DockviewVue,
  type DockviewApi,
  type DockviewGroupPanel,
  type DockviewReadyEvent,
  type DockviewWillShowOverlayLocationEvent,
  type Position,
  type PositionResolver,
  type VueComponent,
} from "dockview-vue";
import { computed, onBeforeUnmount, provide, ref, watch } from "vue";
import type { PanelBounds } from "../../shared/host-api";
import { Button } from "@/components/ui/button";
import { act, api as host, dialog, dragging, nextPanelSlot, panelToShow, state } from "../host";
import { t, templateName } from "../i18n";
import { LAYOUT_TEMPLATES } from "../../shared/layout-templates";
import {
  dropAllowed,
  fromDockview,
  groupMinimum,
  guardDrop,
  guideFits,
  placePanel,
  placeTab,
  resolveDropPosition,
  resolveOuterEdge,
  toDockview,
  type PanelInfo,
} from "../dock";
import DropGuide, { type GuideState } from "../components/workspace/DropGuide.vue";
import GameIcon from "../components/GameIcon.vue";
import EmptySlot from "../components/workspace/EmptySlot.vue";
import GroupActions from "../components/workspace/GroupActions.vue";
import LayoutsMenu from "../components/workspace/LayoutsMenu.vue";
import GridPicker from "../components/workspace/GridPicker.vue";
import TemplatePreview from "../components/workspace/TemplatePreview.vue";
import CampfireLoader from "../components/workspace/CampfireLoader.vue";
import PanelContent from "../components/workspace/PanelContent.vue";
import PanelTab from "../components/workspace/PanelTab.vue";
import { DOCK } from "../components/workspace/dock-context";

/** Width of a panel card's border (dock.css), in px. */
const CARD_BORDER = 1;
/** Space between panel cards and around the dock, in px. */
const GAP = 8;
const THEME = { name: "tavora", className: "dockview-theme-tavora", colorScheme: "dark" as const, gap: GAP };
/** How long the layout must be still before it is saved. */
const SAVE_DELAY_MS = 300;

const view = computed(() => state.value!);
const game = computed(() => (view.value.currentGameId ? view.value.library.games[view.value.currentGameId] : undefined));

function info(instanceId: string): PanelInfo | undefined {
  const panel = view.value.panels.find((item) => item.instanceId === instanceId);
  const module = panel && view.value.modules.find((item) => item.id === panel.moduleId);
  // A panel type may need more (or less) room than its module.
  const size = module?.panels.find((type) => type.id === panel?.panelType) ?? module;
  // A panel card's 1 px border on each side comes out of the module's room.
  return panel && size
    ? { title: panel.name, minWidth: size.minWidth + 2 * CARD_BORDER, minHeight: size.minHeight + 2 * CARD_BORDER }
    : undefined;
}

// ── Where panels are ───────────────────────────────────────────────────

const elements = new Map<string, HTMLElement>();
const resizes = new ResizeObserver(() => reportSoon());
let dock: DockviewApi | null = null;
let lastReport = "";
let reportFrame = 0;

provide(DOCK, {
  info,
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
      if (!element.isConnected || !dock?.getPanel(instanceId)?.api.isVisible) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      bounds.push({ instanceId, x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    }
    const report = JSON.stringify(bounds);
    if (report === lastReport) return;
    lastReport = report;
    host.setPanelBounds(bounds);
  });
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
    const layout = view.value.layout;
    try {
      if (layout) api.fromJSON(toDockview(layout, info));
      else api.clear();
    } catch (error) {
      console.error("[tavora] could not restore the layout", error);
      api.clear();
    }
  });
  reconcile(api);
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
  updateConstraints(api);
  if (changed) saveSoon();
}

/** Gives every group the minimum size of its largest module, so splits never squeeze one below it. */
function updateConstraints(api: DockviewApi) {
  for (const group of api.groups as DockviewGroupPanel[]) {
    const min = groupMinimum(group, info);
    if (group.minimumWidth !== min.width || group.minimumHeight !== min.height) {
      group.api.setConstraints({ minimumWidth: min.width, minimumHeight: min.height });
    }
  }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (dock) void act({ type: "save-layout", layout: fromDockview(dock.toJSON()) }, { quiet: true });
  }, SAVE_DELAY_MS);
}

watch(
  () => view.value.panels.map((panel) => panel.instanceId).join(),
  () => dock && reconcile(dock),
);
// Another panel of the module opened this one (panels.open): bring it to the front of its group.
watch(panelToShow, (request) => {
  if (!request || !dock) return;
  panelToShow.value = null;
  dock.getPanel(request.instanceId)?.api.setActive();
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
let resizing = false;

function endDrag() {
  resizing = false;
  dragging.value = false;
  guide.value = null;
}

// ── The drop guide ─────────────────────────────────────────────────────

const guide = ref<GuideState | null>(null);
const POSITIONS: Position[] = ["top", "left", "center", "right", "bottom"];

/**
 * Picks where a drop goes. The outer edges of the dock work as dockview's
 * do; over a group, the guide's cells decide, else the nearest edge, else
 * the middle. The outer target is the only one as big as the whole dock.
 */
const dropResolver: PositionResolver = {
  resolve({ x, y, width, height, zones }) {
    const outer = dock && width >= dock.width - 1 && height >= dock.height - 1;
    const position = outer ? resolveOuterEdge(x, y, width, height, zones) : resolveDropPosition(x, y, width, height, zones);
    return position ? { position } : null;
  },
};

/** Shows the guide over the group a panel is dragged across, and hides drops that would not fit. */
function onWillShowOverlay(event: DockviewWillShowOverlayLocationEvent, api: DockviewApi) {
  const data = event.getData();
  if (!dropAllowed(api, info, data, event.group, event.position)) event.preventDefault();
  const content = event.kind === "content" ? event.group?.element.querySelector(".dv-content-container") : null;
  const container = root.value;
  if (!content || !container) {
    guide.value = null;
    return;
  }
  const area = content.getBoundingClientRect();
  const origin = container.getBoundingClientRect();
  if (!guideFits(area.width, area.height)) {
    guide.value = null;
    return;
  }
  const allowed = Object.fromEntries(POSITIONS.map((position) => [position, dropAllowed(api, info, data, event.group, position)]));
  guide.value = {
    x: area.left - origin.left,
    y: area.top - origin.top,
    width: area.width,
    height: area.height,
    position: event.position,
    allowed: allowed as Record<Position, boolean>,
  };
}
function endResize() {
  if (resizing) endDrag();
}
addEventListener("dragend", endDrag, true);
addEventListener("drop", endDrag, true);
addEventListener("pointerup", endDrag, true);
addEventListener("pointercancel", endResize, true);
addEventListener("resize", reportSoon);

function onPointerDown(event: PointerEvent) {
  if (!(event.target as Element | null)?.closest(".dv-sash")) return;
  resizing = true;
  dragging.value = true;
}

function onReady({ api }: DockviewReadyEvent) {
  dock = api;
  restore(api);
  api.onDidLayoutChange(() => {
    reportSoon();
    if (!applying) saveSoon();
  });
  api.onDidAddGroup(() => updateConstraints(api));
  api.onDidMovePanel(() => updateConstraints(api));
  api.onDidActivePanelChange(() => {
    updateConstraints(api);
    reportSoon();
  });
  api.onDidMaximizedGroupChange(() => reportSoon());
  api.onWillDragPanel(() => (dragging.value = true));
  api.onWillDragGroup(() => (dragging.value = true));
  api.onWillDrop((event) => guardDrop(event, api, info));
  api.onWillShowOverlay((event) => onWillShowOverlay(event, api));
  api.onDidDrop(() => endDrag());
}

const root = ref<HTMLElement | null>(null);
watch(root, (element, previous) => {
  if (previous) resizes.unobserve(previous);
  if (element) resizes.observe(element);
});

onBeforeUnmount(() => {
  clearTimeout(saveTimer);
  cancelAnimationFrame(reportFrame);
  resizes.disconnect();
  removeEventListener("dragend", endDrag, true);
  removeEventListener("drop", endDrag, true);
  removeEventListener("pointerup", endDrag, true);
  removeEventListener("pointercancel", endResize, true);
  removeEventListener("resize", reportSoon);
  endDrag();
  host.setPanelBounds([]);
});

// The library types components loosely; these take its documented props.
const components = { panel: PanelContent as unknown as VueComponent };
const tab = PanelTab as unknown as VueComponent;
const groupActions = GroupActions as unknown as VueComponent;
const emptySlot = EmptySlot as unknown as VueComponent;
</script>

<template>
  <main class="flex h-full min-w-0 flex-col" data-testid="workspace">
    <header class="app-drag flex h-14 flex-none items-center gap-3 pr-[calc(100vw-env(titlebar-area-x,0px)-env(titlebar-area-width,100vw)+1rem)] pl-4">
      <GameIcon v-if="game" :game="game" :size="32" />
      <h1 class="max-w-72 min-w-0 truncate text-lg font-semibold">{{ game?.name }}</h1>
      <span class="text-info ml-auto min-w-0 truncate text-sm" role="status" data-testid="notice">{{ view.notice ?? "" }}</span>
      <div class="app-no-drag flex flex-none items-center gap-2">
        <LayoutsMenu />
        <Button size="sm" variant="secondary" data-testid="add-module" @click="dialog = { kind: 'add-module' }">
          <Plus :stroke-width="1.5" /> {{ t("workspace.addModule") }}
        </Button>
      </div>
    </header>

    <div ref="root" class="relative min-h-0 flex-1" @pointerdown.capture="onPointerDown">
      <DockviewVue
        class="absolute inset-x-2 top-0 bottom-2"
        :theme="THEME"
        :components="components"
        :default-tab-component="tab"
        :right-header-actions-component="groupActions"
        :watermark-component="emptySlot"
        :disable-floating-groups="true"
        dnd-strategy="html5"
        :drop-position-resolver="dropResolver"
        @ready="onReady"
      />
      <DropGuide v-if="guide" :guide="guide" />
      <!-- The game just opened: one card over the dock, where the panels go, until every panel has its data and all show at once. -->
      <div v-if="view.opening" class="bg-background absolute inset-x-2 top-0 bottom-2 z-20 rounded-[10px] border" data-testid="workspace-loading">
        <CampfireLoader :name="game?.name ?? ''" />
      </div>
      <div
        v-if="!view.panels.length && !view.layout"
        class="bg-background absolute inset-x-2 top-0 bottom-2 z-10 flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed text-center"
        data-testid="empty-workspace"
      >
        <LayoutGrid class="text-muted-foreground mb-2 size-12" :stroke-width="1" />
        <p class="text-lg font-semibold">{{ t("workspace.startTitle") }}</p>
        <p class="text-muted-foreground max-w-sm text-sm">{{ t("workspace.startText", { name: game?.name ?? "" }) }}</p>
        <div class="mt-3 flex flex-wrap justify-center gap-2" role="group" :aria-label="t('workspace.chooseLayout')" data-testid="empty-templates">
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
        <p class="text-muted-foreground mt-2 text-xs">{{ t("layouts.grid") }}</p>
        <GridPicker plain />
      </div>
    </div>
  </main>
</template>
