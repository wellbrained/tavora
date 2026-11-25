<script setup lang="ts">
// An item card in a hover card, with a button of your own between its parts: `bare` leaves the surface to the item
// card. Click the tower to pin it; the close button sits on the card's corner.
import { Plus } from "@lucide/vue";
import type { TooltipContent } from "@tavora/sdk";
import { Button } from "@tavora/official-ui/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@tavora/official-ui/components/ui/hover-card";
import { ItemCard, ItemCardEffect, ItemCardName, ItemCardStats, ItemCardType } from "@tavora/official-ui/components/ui/item-card";
import { ref } from "vue";

const tower: TooltipContent = {
  title: "Archer Tower",
  subtitle: "Tower · Level 2",
  layout: "card",
  badges: ["Rare"],
  effect: [{ text: "Shoots the nearest enemy for " }, { text: "12", accent: true }, { text: " damage every " }, { text: "1.5 s", accent: true }, { text: "." }],
  properties: [{ label: "Range", value: "3 plots" }, { label: "Cost", value: "40 gold" }],
};
const placed = ref(0);
</script>

<template>
  <div class="flex items-center gap-3 text-sm">
    <HoverCard pinnable>
      <HoverCardTrigger focusable class="bg-accent rounded-md px-3 py-1.5 font-medium">Archer Tower</HoverCardTrigger>
      <HoverCardContent bare label="Archer Tower">
        <ItemCard :content="tower">
          <ItemCardName :content="tower" />
          <ItemCardType :content="tower" />
          <ItemCardEffect :content="tower" />
          <ItemCardStats :content="tower" />
          <Button size="xs" class="self-start" @click="placed++"><Plus /> Place one</Button>
        </ItemCard>
      </HoverCardContent>
    </HoverCard>
    <span v-if="placed" class="text-muted-foreground">{{ placed }} placed</span>
  </div>
</template>
