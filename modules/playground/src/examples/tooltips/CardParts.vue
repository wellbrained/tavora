<script setup lang="ts">
// A card of your own, made of the item card's parts: put them in an ItemCard's slot in any order, with your own markup
// between them (here the tooltip's freestanding TooltipText for a note). Each part reads the same content and draws
// nothing for what the card doesn't have; the card keeps its layout's look and its skin.
import type { TooltipContent } from "@tavora/sdk";
import { TooltipText } from "@tavora/official-ui";
import { ItemCard, ItemCardEffect, ItemCardName, ItemCardSections, ItemCardStats, ItemCardType } from "@tavora/official-ui/components/ui/item-card";

const relic: TooltipContent = {
  title: "Ember Relic",
  subtitle: "Relic · Fire",
  layout: "card",
  badges: ["Epic"],
  effect: [{ text: "Burning enemies take " }, { text: "+15%", accent: true }, { text: " damage." }],
  properties: [{ label: "Burn damage", value: "8", more: ["10", "–"] }, { label: "Burn time", value: "3 s", more: ["4 s", "5 s"] }],
  columns: ["Lv 1", "Lv 2", "Lv 3"],
  sections: [{ title: "Found in", rows: [{ text: "Ashen Caves", status: "Common" }] }],
};
</script>

<template>
  <div class="flex flex-wrap items-start gap-4">
    <ItemCard :content="relic" />
    <ItemCard :content="relic">
      <ItemCardName :content="relic" />
      <ItemCardType :content="relic" />
      <ItemCardStats :content="relic" />
      <TooltipText tone="muted" size="small" text="You have 2 of these." />
      <ItemCardEffect :content="relic" />
      <ItemCardSections :content="relic" />
    </ItemCard>
  </div>
</template>
