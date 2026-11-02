<script setup lang="ts">
import { Plus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { TabStrip, type StripTab } from "@tavora/official-ui/components/ui/tabs";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const stripTabs = ref<StripTab[]>(["Iron", "Copper", "Steel", "Plastic"].map((label) => ({ id: label.toLowerCase(), label, closable: true, renamable: true })));
const stripActive = ref("iron");
let stripCount = 0;
function closeStripTab(id: string) {
  if (stripTabs.value.length > 1) stripTabs.value = stripTabs.value.filter((tab) => tab.id !== id);
}
function reorderStrip(order: string[]) {
  stripTabs.value = order.map((id) => stripTabs.value.find((tab) => tab.id === id)!);
}
function renameStripTab(id: string, label: string) {
  stripTabs.value = stripTabs.value.map((tab) => (tab.id === id ? { ...tab, label } : tab));
}
function addStripTab() {
  stripCount += 1;
  const tab = { id: `new-${stripCount}`, label: `New plan ${stripCount}`, closable: true, renamable: true };
  stripTabs.value = [...stripTabs.value, tab];
  stripActive.value = tab.id;
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <TabStrip v-model="stripActive" :tabs="stripTabs" aria-label="Plans" data-testid="tab-strip" @close="closeStripTab" @reorder="reorderStrip" @rename="renameStripTab">
      <template #add>
        <Button variant="ghost" size="icon-sm" aria-label="New tab" data-testid="strip-add" :disabled="off" @click="addStripTab"><Plus :stroke-width="1.5" /></Button>
      </template>
    </TabStrip>
    <p class="text-muted-foreground text-xs">Drag to reorder (or Alt + ← / →), middle-click or Delete to close, double-click or F2 to rename. The last one can't be closed.</p>
    <p class="text-muted-foreground text-xs" data-testid="strip-state">{{ stripTabs.map((tab) => tab.label).join(", ") }} · open: {{ stripTabs.find((tab) => tab.id === stripActive)?.label ?? "none" }}</p>
  </div>
</template>
