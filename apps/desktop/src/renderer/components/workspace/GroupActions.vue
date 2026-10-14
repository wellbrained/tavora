<script setup lang="ts">
// The ⋯ button at the right end of a group's tab bar, for its selected panel.
import type { IDockviewHeaderActionsProps } from "dockview-vue";
import { computed, inject } from "vue";
import { state } from "../../host";
import MenuButton from "../menus/MenuButton.vue";
import { DOCK, panelMenu } from "./dock-context";

const props = defineProps<{ params: IDockviewHeaderActionsProps }>();
const dock = inject(DOCK)!;
const name = computed(() => {
  const id = props.params.activePanel?.id;
  return state.value?.panels.find((item) => item.instanceId === id)?.name ?? "Panel";
});

function items() {
  const panel = props.params.activePanel;
  return panel ? panelMenu(panel, props.params.containerApi, dock.info) : [];
}
</script>

<template>
  <div class="flex h-full items-center pr-1">
    <MenuButton
      v-if="params.activePanel"
      :items="items"
      :title="name"
      testid="group-menu"
      :label="`${name} options`"
      side="bottom"
      align="end"
    />
  </div>
</template>
