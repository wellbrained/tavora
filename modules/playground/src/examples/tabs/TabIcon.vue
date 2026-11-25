<script setup lang="ts">
// The #icon slot puts something before a tab's name; it stays while the tab is renamed.
import { Link2 } from "@lucide/vue";
import { Tooltip, useTooltip } from "@tavora/official-ui";
import { TabStrip, type StripTab } from "@tavora/official-ui/components/ui/tabs";
import { ref } from "vue";

const tabs = ref<StripTab[]>([{ id: "iron", label: "Iron", closable: true, renamable: true }, { id: "copper", label: "Copper", renamable: true }]);
const active = ref("iron");
const feeds = (id: string) => (id === "iron" ? ["Copper"] : []);

const tip = useTooltip<string>();
</script>

<template>
  <div class="flex flex-col gap-2">
    <TabStrip v-model="active" :tabs="tabs" aria-label="Linked plans" data-testid="tab-strip-icon" @rename="(id, label) => (tabs = tabs.map((tab) => (tab.id === id ? { ...tab, label } : tab)))">
      <template #icon="{ tab }">
        <Link2
          v-if="feeds(tab.id).length"
          class="text-primary size-3.5 flex-none"
          :aria-label="`Feeds ${feeds(tab.id).join(', ')}`"
          data-testid="plan-tab-feeds"
          v-bind="tip.on(`Feeds ${feeds(tab.id).join(', ')}`, { focusable: true })"
        />
      </template>
    </TabStrip>
    <Tooltip v-bind="tip.props" compact :title="tip.content ?? ''" />
    <p class="text-muted-foreground text-xs">The icon stays while you rename the tab.</p>
  </div>
</template>
