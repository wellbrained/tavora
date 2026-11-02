<script setup lang="ts">
// The #icon slot puts something before a tab's name; it stays while the tab is renamed.
import { Link2 } from "@lucide/vue";
import { Tooltip } from "@tavora/official-ui";
import { TabStrip, type StripTab } from "@tavora/official-ui/components/ui/tabs";
import { ref } from "vue";

const tabs = ref<StripTab[]>([{ id: "iron", label: "Iron", closable: true, renamable: true }, { id: "copper", label: "Copper", renamable: true }]);
const active = ref("iron");
const feeds = (id: string) => (id === "iron" ? ["Copper"] : []);

const tip = ref<{ open: boolean; anchor: { left: number; top: number; right: number; bottom: number } }>({ open: false, anchor: { left: 0, top: 0, right: 0, bottom: 0 } });
function showTip(event: Event) {
  const { left, top, right, bottom } = (event.currentTarget as HTMLElement).getBoundingClientRect();
  tip.value = { open: true, anchor: { left, top, right, bottom } };
}
const hideTip = () => (tip.value.open = false);
</script>

<template>
  <div class="flex flex-col gap-2">
    <TabStrip v-model="active" :tabs="tabs" aria-label="Linked plans" data-testid="tab-strip-icon" @rename="(id, label) => (tabs = tabs.map((tab) => (tab.id === id ? { ...tab, label } : tab)))">
      <template #icon="{ tab }">
        <Link2
          v-if="feeds(tab.id).length"
          class="text-primary size-3.5 flex-none"
          :stroke-width="1.5"
          tabindex="0"
          :aria-label="`Feeds ${feeds(tab.id).join(', ')}`"
          data-testid="plan-tab-feeds"
          @pointerenter="showTip"
          @pointerleave="hideTip"
          @focus="showTip"
          @blur="hideTip"
        />
      </template>
    </TabStrip>
    <Tooltip :open="tip.open" :anchor="tip.anchor" compact title="Feeds Copper" @dismiss="hideTip" />
    <p class="text-muted-foreground text-xs">The icon stays while you rename the tab.</p>
  </div>
</template>
