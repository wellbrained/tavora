<script setup lang="ts">
// The right end of a group's tab bar: the tabs that don't fit (a list or two arrows, by the
// "Too many tabs" setting), hiding the column, and the ⋯ button for its selected panel.
// Dockview's own list of hidden tabs is hidden (dock.css): it is plain page content, so the
// module views would cover it; the kit's menu freezes them while it is open.
import type { IDockviewHeaderActionsProps } from "dockview-vue";
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { state, type MenuItem } from "../../host";
import { t } from "../../i18n";
import MenuButton from "../menus/MenuButton.vue";
import { DOCK, panelMenu } from "./dock-context";
import { ChevronDown, ChevronLeft, ChevronRight, PanelLeftClose, PanelRightClose } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";

const props = defineProps<{ params: IDockviewHeaderActionsProps }>();
const dock = inject(DOCK)!;
const side = computed(() => dock.collapseSide(props.params.group.id));
const collapseLabel = computed(() => t(side.value === "left" ? "dock.hideLeftColumn" : "dock.hideRightColumn"));
const name = computed(() => {
  const id = props.params.activePanel?.id;
  return state.value?.panels.find((item) => item.instanceId === id)?.name ?? t("workspace.panel");
});

// ── Tabs that don't fit ────────────────────────────────────────────────

/** The group's panels whose tab is not entirely in view, in tab order. */
const hidden = ref<string[]>([]);
const activeIndex = ref(-1);
const arrows = computed(() => state.value?.library.tabOverflow === "arrows");

function tabsRow(): HTMLElement | null {
  return props.params.group.element.querySelector<HTMLElement>(".dv-tabs-container");
}

function tabOf(row: HTMLElement, id: string): Element | null | undefined {
  return row.querySelector(`[data-testid="panel-${CSS.escape(id)}"]`)?.closest(".dv-tab");
}

/**
 * Finds the tabs out of view. Unless the user scrolled the row, the open tab is brought into it first: Dockview
 * does that only when a tab opens, not when the row gets narrower or the tabs wider.
 */
function measure(keepActive = true) {
  const row = tabsRow();
  const panels = props.params.group.panels;
  activeIndex.value = panels.findIndex((panel) => panel.id === props.params.group.activePanel?.id);
  if (!row) return;
  const box = row.getBoundingClientRect();
  const active = props.params.group.activePanel && tabOf(row, props.params.group.activePanel.id)?.getBoundingClientRect();
  if (keepActive && active) {
    const by = active.right > box.right + 1 ? Math.min(active.right - box.right, active.left - box.left) : active.left < box.left - 1 ? active.left - box.left : 0;
    if (by) {
      row.scrollLeft += by;
      // Dockview keeps its own copy of the row's scroll position and writes it back; a scroll event updates it now.
      row.dispatchEvent(new Event("scroll"));
    }
  }
  const next = panels
    .filter((panel) => {
      const rect = tabOf(row, panel.id)?.getBoundingClientRect();
      return rect ? rect.left < box.left - 1 || rect.right > box.right + 1 : false;
    })
    .map((panel) => panel.id);
  if (next.join() !== hidden.value.join()) hidden.value = next;
}

let frame = 0;
/** Whether the frame asked for brings the open tab into view. */
let pendingKeep = false;
function measureLater(keep: boolean) {
  if (frame && pendingKeep) return;
  cancelAnimationFrame(frame);
  pendingKeep = keep;
  frame = requestAnimationFrame(() => {
    frame = 0;
    measure(keep);
  });
}
const measureSoon = () => measureLater(true);
/** After the user scrolled the row: count again, but leave the row where they put it. */
const measureScrolled = () => measureLater(false);
const sizes = new ResizeObserver(measureSoon);
const changes = new MutationObserver(() => {
  const row = tabsRow();
  if (row) for (const tab of row.children) sizes.observe(tab);
  measureSoon();
});
const listeners: { dispose(): void }[] = [];
let watchedRow: HTMLElement | null = null;

onMounted(() => {
  watchedRow = tabsRow();
  if (watchedRow) {
    sizes.observe(watchedRow);
    for (const tab of watchedRow.children) sizes.observe(tab);
    changes.observe(watchedRow, { childList: true, subtree: true, characterData: true });
    watchedRow.addEventListener("scroll", measureScrolled, { passive: true });
  }
  listeners.push(props.params.group.api.onDidActivePanelChange(measureSoon), props.params.containerApi.onDidLayoutChange(measureSoon));
  measureSoon();
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  sizes.disconnect();
  changes.disconnect();
  watchedRow?.removeEventListener("scroll", measureScrolled);
  for (const listener of listeners) listener.dispose();
});

function hiddenItems(): MenuItem[] {
  return hidden.value.map((id) => {
    const panel = state.value?.panels.find((item) => item.instanceId === id);
    return {
      label: panel?.name ?? t("workspace.panel"),
      icon: panel ? { moduleId: panel.moduleId, panelType: panel.panelType } : undefined,
      testid: `hidden-tab-${id}`,
      run: () => props.params.containerApi.getPanel(id)?.api.setActive(),
    };
  });
}

/** The arrows step to the tab before or after the open one; the row follows it. */
function step(by: 1 | -1) {
  const panels = props.params.group.panels;
  panels[activeIndex.value + by]?.api.setActive();
}

function items() {
  const panel = props.params.activePanel;
  return panel ? panelMenu(panel, props.params.containerApi, dock.info) : [];
}
</script>

<template>
  <div class="flex h-full items-center pr-1">
    <template v-if="hidden.length">
      <template v-if="arrows">
        <Button
          variant="ghost"
          size="icon"
          class="size-7"
          :disabled="activeIndex <= 0"
          :aria-label="t('dock.previousTab')"
          :title="t('dock.previousTab')"
          data-testid="previous-tab"
          @click="step(-1)"
        >
          <ChevronLeft class="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="size-7"
          :disabled="activeIndex >= params.group.panels.length - 1"
          :aria-label="t('dock.nextTab')"
          :title="t('dock.nextTab')"
          data-testid="next-tab"
          @click="step(1)"
        >
          <ChevronRight class="size-4" aria-hidden="true" />
        </Button>
      </template>
      <MenuButton
        v-else
        :items="hiddenItems"
        :title="t('dock.moreTabs', { count: hidden.length })"
        testid="hidden-tabs"
        :label="t('dock.moreTabs', { count: hidden.length })"
        side="bottom"
        align="end"
        class="size-auto h-7 px-1.5 text-xs tabular-nums"
      >
        <span class="flex items-center gap-0.5"><ChevronDown class="size-4" :stroke-width="1.5" aria-hidden="true" />{{ hidden.length }}</span>
      </MenuButton>
    </template>
    <Button
      v-if="side"
      variant="ghost"
      size="icon"
      class="size-7"
      :aria-label="collapseLabel"
      :title="collapseLabel"
      :data-testid="`hide-${side}-column`"
      @click="dock.collapseColumn(side!)"
    >
      <component :is="side === 'left' ? PanelLeftClose : PanelRightClose" class="size-4" aria-hidden="true" />
    </Button>
    <MenuButton
      v-if="params.activePanel"
      :items="items"
      :title="name"
      testid="group-menu"
      :label="t('workspace.options', { name })"
      side="bottom"
      align="end"
    />
  </div>
</template>
