<script setup lang="ts">
// TabStrip only tells you what the user did; the tabs are yours to change.
import { Plus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { TabStrip, type StripTab } from "@tavora/official-ui/components/ui/tabs";
import { ref } from "vue";

const tabs = ref<StripTab[]>(["Iron", "Copper", "Steel", "Plastic"].map((label) => ({ id: label.toLowerCase(), label, closable: true, renamable: true })));
const active = ref("iron");
let added = 0;

function close(id: string) {
  if (tabs.value.length > 1) tabs.value = tabs.value.filter((tab) => tab.id !== id);
}
function reorder(order: string[]) {
  tabs.value = order.map((id) => tabs.value.find((tab) => tab.id === id)!);
}
function rename(id: string, label: string) {
  tabs.value = tabs.value.map((tab) => (tab.id === id ? { ...tab, label } : tab));
}
function add() {
  added += 1;
  const tab = { id: `new-${added}`, label: `New plan ${added}`, closable: true, renamable: true };
  tabs.value = [...tabs.value, tab];
  active.value = tab.id;
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <TabStrip v-model="active" :tabs="tabs" aria-label="Plans" data-testid="tab-strip" @close="close" @reorder="reorder" @rename="rename">
      <template #add>
        <Button variant="ghost" size="icon-sm" aria-label="New tab" data-testid="strip-add" @click="add"><Plus :stroke-width="1.5" /></Button>
      </template>
    </TabStrip>
    <p class="text-muted-foreground text-xs">Drag to reorder (or Alt + ← / →), middle-click or Delete to close, double-click or F2 to rename. The last one can't be closed.</p>
    <p class="text-muted-foreground text-xs" data-testid="strip-state">{{ tabs.map((tab) => tab.label).join(", ") }} · open: {{ tabs.find((tab) => tab.id === active)?.label ?? "none" }}</p>
  </div>
</template>
