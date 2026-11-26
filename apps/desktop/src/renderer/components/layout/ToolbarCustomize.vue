<script setup lang="ts">
// Customize toolbar…: what is in the frame toolbar, one checkbox row per menu row that can be a button, in the menu's order.
// A change applies at once and is one setting for every frame (not an undo step). Reset to default brings back Settings,
// Hide on canvas, Reset position, Reset size and Remove. The popover itself is placed by LayoutCanvas.vue.
import { computed } from "vue";
import { CheckboxField } from "@tavora/official-ui/components/ui/checkbox-field";
import { TextLink } from "@tavora/official-ui/components/ui/text-link";
import { DEFAULT_BUTTONS, TOOLBAR_ACTIONS, isGroupAction, toggleButton, type ToolbarActionId } from "../../../shared/layout-toolbar";
import type { LayoutItemView } from "../../../shared/layout-view";
import { t } from "../../i18n";
import { frameActions } from "./frame-actions";
import { send, view } from "./layout-state";

/** `items`: the frames the toolbar is for, only to word the rows (Hide or Show on canvas, Lock or Unlock). */
const props = defineProps<{ items: LayoutItemView[] }>();

const buttons = computed(() => view.value?.toolbar.buttons ?? []);
const actions = computed(() => frameActions(props.items));
/** The rows are named for the action, not for its state (Hide on canvas, Lock position). */
const labelOf = (id: ToolbarActionId) => (id === "hide" ? t("overlays.layout.hideOnCanvas") : id === "lock" ? t("overlays.layout.lock") : actions.value[id].label);
const isDefault = computed(() => buttons.value.join() === DEFAULT_BUTTONS.join());

const toggle = (id: ToolbarActionId) => send({ type: "toolbar", buttons: toggleButton(buttons.value, id) });
const reset = () => send({ type: "toolbar", buttons: [...DEFAULT_BUTTONS] });
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="layout-toolbar-customize">
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm font-medium">{{ t("overlays.layout.customizeToolbar") }}</p>
      <TextLink class="text-primary text-sm" :disabled="isDefault" data-testid="layout-customize-default" @click="reset">
        {{ t("overlays.layout.resetToolbar") }}
      </TextLink>
    </div>
    <ul class="flex flex-col">
      <li v-for="id in TOOLBAR_ACTIONS" :key="id">
        <CheckboxField :model-value="buttons.includes(id)" :label="labelOf(id)" class="cursor-default" :data-testid="`layout-customize-${id}`" @update:model-value="toggle(id)">
          <template #leading><component :is="actions[id].icon" class="text-muted-foreground size-4 shrink-0" /></template>
          <template v-if="isGroupAction(id)" #trailing>▾</template>
        </CheckboxField>
      </li>
    </ul>
  </div>
</template>
