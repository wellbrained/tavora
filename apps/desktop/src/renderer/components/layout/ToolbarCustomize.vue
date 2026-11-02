<script setup lang="ts">
// Customize toolbar…: what is in the frame toolbar, one checkbox row per menu row that can be a button, in the menu's order.
// A change applies at once and is one setting for every frame (not an undo step). Reset to default brings back Settings,
// Hide on canvas, Reset position, Reset size and Remove. The popover itself is placed by LayoutCanvas.vue.
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { DEFAULT_PINS, TOOLBAR_ACTIONS, isGroupAction, togglePin, type ToolbarActionId } from "../../../shared/layout-toolbar";
import type { LayoutItemView } from "../../../shared/layout-view";
import { t } from "../../i18n";
import { frameActions } from "./frame-actions";
import { send, view } from "./layout-state";

/** `items`: the frames the toolbar is for, only to word the rows (Hide or Show on canvas, Lock or Unlock). */
const props = defineProps<{ items: LayoutItemView[] }>();

const pins = computed(() => view.value?.toolbar.pins ?? []);
const actions = computed(() => frameActions(props.items));
/** The rows are named for the action, not for its state (Hide on canvas, Lock position). */
const labelOf = (id: ToolbarActionId) => (id === "hide" ? t("overlays.layout.hideOnCanvas") : id === "lock" ? t("overlays.layout.lock") : actions.value[id].label);
const isDefault = computed(() => pins.value.join() === DEFAULT_PINS.join());

const toggle = (id: ToolbarActionId) => send({ type: "toolbar", pins: togglePin(pins.value, id) });
const reset = () => send({ type: "toolbar", pins: [...DEFAULT_PINS] });
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="layout-toolbar-customize">
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm font-medium">{{ t("overlays.layout.customizeToolbar") }}</p>
      <Button type="button" variant="link" size="sm" class="h-auto p-0" :disabled="isDefault" data-testid="layout-customize-default" @click="reset">
        {{ t("overlays.layout.resetToolbar") }}
      </Button>
    </div>
    <ul class="flex flex-col">
      <li v-for="id in TOOLBAR_ACTIONS" :key="id">
        <label class="hover:bg-accent flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-sm">
          <Checkbox :model-value="pins.includes(id)" :data-testid="`layout-customize-${id}`" @update:model-value="toggle(id)" />
          <component :is="actions[id].icon" class="text-muted-foreground size-4 shrink-0" :stroke-width="1.5" />
          <span class="min-w-0 flex-1 truncate">{{ labelOf(id) }}</span>
          <span v-if="isGroupAction(id)" class="text-muted-foreground flex-none text-xs">▾</span>
        </label>
      </li>
    </ul>
  </div>
</template>
