<script setup lang="ts">
// Fills an empty slot of the layout, such as one a template made: add a
// module here, or remove the slot. The docking library shows it in every
// group without panels.
import { Plus, X } from "@lucide/vue";
import type { IWatermarkPanelProps } from "dockview-vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { dialog } from "../../host";
import { t } from "../../i18n";

const props = defineProps<{ params: IWatermarkPanelProps }>();

function remove() {
  const group = props.params.group;
  if (group) props.params.containerApi.removeGroup(group);
}
</script>

<template>
  <div
    v-if="params.group"
    class="flex size-full flex-col items-center justify-center gap-2 p-4 text-center"
    :data-testid="`empty-slot-${params.group.id}`"
  >
    <Button
      variant="outline"
      size="sm"
      class="border-primary/60 text-primary hover:bg-primary/10 hover:text-primary"
      data-testid="slot-add-module"
      @click="dialog = { kind: 'add-module', slot: params.group.id }"
    >
      <Plus :stroke-width="1.5" /> {{ t("workspace.addModule") }}
    </Button>
    <Button variant="danger" size="sm" data-testid="slot-remove" @click="remove">
      <X :stroke-width="1.5" /> {{ t("workspace.removeSlot") }}
    </Button>
  </div>
</template>
