<script setup lang="ts">
// A game's workspace: the toolbar and the docking area. The docking library
// lays out tabs, groups and splits in this page; each panel's module runs in
// a native view that the main process draws over the panel's content area,
// at the bounds this page reports.
import { Plus } from "@lucide/vue";
import {
  DockviewVue,
  type DockviewApi,
  type DockviewGroupPanel,
  type DockviewReadyEvent,
  type VueComponent,
} from "dockview-vue";
import { computed, onBeforeUnmount, provide, ref, watch } from "vue";
import type { PanelBounds } from "../../shared/host-api";
import { Button } from "@/components/ui/button";
import { act, api as host, dragging, state } from "../host";
import { fromDockview, groupMinimum, guardDrop, placePanel, toDockview, type PanelInfo } from "../dock";
import GroupActions from "../components/workspace/GroupActions.vue";
import LayoutsMenu from "../components/workspace/LayoutsMenu.vue";
import PanelContent from "../components/workspace/PanelContent.vue";
import PanelTab from "../components/workspace/PanelTab.vue";
import { DOCK } from "../components/workspace/dock-context";

const THEME = { name: "tavora", className: "dockview-theme-tavora", colorScheme: "dark" as const, gap: 0 };
/** How long the layout must be still before it is saved. */
const SAVE_DELAY_MS = 300;

const view = computed(() => state.value!);
const game = computed(() => (view.value.currentGameId ? view.value.library.games[view.value.currentGameId] : undefined));

function info(instanceId: string): PanelInfo | undefined {
  const panel = view.value.panels.find((item) => item.instanceId === instanceId);
  const module = panel && view.value.modules.find((item) => item.id === panel.moduleId);
  return panel && module ? { title: panel.name, minWidth: module.minWidth, minHeight: module.minHeight } : undefined;
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
      placePanel(api, id, info);
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
    const layout = dock && fromDockview(dock.toJSON());
    if (layout) void act({ type: "save-layout", layout }, { quiet: true });
  }, SAVE_DELAY_MS);
}

watch(
  () => view.value.panels.map((panel) => panel.instanceId).join(),
  () => dock && reconcile(dock),
);
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
</script>

<template>
  <main class="flex h-full min-w-0 flex-col" data-testid="workspace">
    <header class="flex h-12 flex-none items-center gap-4 border-b px-4">
      <h1 class="max-w-60 flex-none truncate text-lg font-semibold">{{ game?.name }}</h1>
      <div class="flex min-w-0 gap-2 overflow-x-auto" role="group" aria-label="Open a module">
        <Button
          v-for="module in view.modules"
          :key="module.id"
          size="sm"
          variant="secondary"
          :data-testid="`open-${module.id}`"
          :disabled="!module.available"
          :title="module.available ? (module.description ?? `Open ${module.name}`) : `${module.name} does not support this game`"
          @click="act({ type: 'open-module', moduleId: module.id })"
        >
          <Plus :stroke-width="1.5" /> {{ module.name }}
        </Button>
      </div>
      <span class="text-info ml-auto text-sm" role="status" data-testid="notice">{{ view.notice ?? "" }}</span>
      <LayoutsMenu />
    </header>

    <div ref="root" class="relative min-h-0 flex-1" @pointerdown.capture="onPointerDown">
      <DockviewVue
        class="absolute inset-0"
        :theme="THEME"
        :components="components"
        :default-tab-component="tab"
        :right-header-actions-component="groupActions"
        :disable-floating-groups="true"
        dnd-strategy="html5"
        @ready="onReady"
      />
      <div
        v-if="!view.panels.length"
        class="bg-background absolute inset-0 flex flex-col items-center justify-center gap-1 text-center"
        data-testid="empty-workspace"
      >
        <p>No modules open yet.</p>
        <p class="text-muted-foreground">Open one from the bar above. Your layout is saved for this game.</p>
      </div>
    </div>
  </main>
</template>
