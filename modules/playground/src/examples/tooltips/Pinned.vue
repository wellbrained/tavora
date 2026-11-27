<script setup lang="ts">
// `useTooltip({ pin: true })` in the panel: a press on a row pins its card open. A pinned card takes the pointer (select
// its text), shows an X, and stays while you hover other rows; the X or Escape closes it and gives the focus back to its
// row, a press elsewhere or on the row again closes it too. On touch, a long press shows a row's card.
// `maxHeight` holds a long card to a height of its own, and it scrolls.
import type { TooltipContent } from "@tavora/sdk";
import { useTooltip } from "@tavora/official-ui";
import { HoverRow } from "@tavora/official-ui/components/ui/hover-row";
import { ItemTooltip } from "@tavora/official-ui/components/ui/item-card";

const items: TooltipContent[] = [
  { title: "Ember Relic", subtitle: "Relic · Fire", badges: ["Epic"], effect: [{ text: "Burning enemies take " }, { text: "+15%", accent: true }, { text: " damage." }], properties: [{ label: "Burn damage", value: "8" }, { label: "Burn time", value: "3 s" }] },
  {
    title: "Frost Ward",
    subtitle: "Charm · Ice",
    badges: ["Rare"],
    effect: "Slows enemies that hit you.",
    sections: [{ title: "Found in", rows: Array.from({ length: 14 }, (_, i) => ({ text: `Frozen Depths ${i + 1}`, status: i % 3 ? "Common" : "Rare" })) }],
  },
];
const tip = useTooltip<TooltipContent>({ side: "right", pin: true });
</script>

<template>
  <ul class="m-0 flex max-w-xs list-none flex-col gap-1 p-0">
    <HoverRow v-for="item in items" :key="item.title" as="li" class="flex items-center justify-between gap-2 text-sm" v-bind="tip.on(item)">
      <span class="font-medium">{{ item.title }}</span>
      <span class="text-muted-foreground">{{ item.subtitle }}</span>
    </HoverRow>
  </ul>
  <ItemTooltip v-bind="tip.props" :content="tip.content" :max-height="260" />
</template>
