<script setup lang="ts">
import { Link2 } from "@lucide/vue";
import { Tooltip } from "@tavora/official-ui";
import { TabStrip, type StripTab } from "@tavora/official-ui/components/ui/tabs";
import { ref } from "vue";

const iconTabs = ref<StripTab[]>([{ id: "iron", label: "Iron", closable: true, renamable: true }, { id: "copper", label: "Copper", renamable: true }]);
const iconActive = ref("iron");
const feeds = (id: string) => (id === "iron" ? ["Copper"] : []);
const linkTip = ref<{ open: boolean; anchor: { left: number; top: number; right: number; bottom: number } }>({ open: false, anchor: { left: 0, top: 0, right: 0, bottom: 0 } });
function showLinkTip(e: Event) {
  const { left, top, right, bottom } = (e.currentTarget as HTMLElement).getBoundingClientRect();
  linkTip.value = { open: true, anchor: { left, top, right, bottom } };
}
const hideLinkTip = () => (linkTip.value.open = false);
</script>

<template>
  <div class="flex flex-col gap-2">
    <TabStrip v-model="iconActive" :tabs="iconTabs" aria-label="Linked plans" data-testid="tab-strip-icon" @rename="(id, label) => (iconTabs = iconTabs.map((tab) => (tab.id === id ? { ...tab, label } : tab)))">
      <template #icon="{ tab }">
        <Link2
          v-if="feeds(tab.id).length"
          class="text-primary size-3.5 flex-none"
          :stroke-width="1.5"
          tabindex="0"
          :aria-label="`Feeds ${feeds(tab.id).join(', ')}`"
          data-testid="plan-tab-feeds"
          @pointerenter="showLinkTip"
          @pointerleave="hideLinkTip"
          @focus="showLinkTip"
          @blur="hideLinkTip"
        />
      </template>
    </TabStrip>
    <Tooltip :open="linkTip.open" :anchor="linkTip.anchor" compact title="Feeds Copper" @dismiss="hideLinkTip" />
    <p class="text-muted-foreground text-xs">The icon stays while you rename the tab.</p>
  </div>
</template>
