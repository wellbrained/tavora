<script setup lang="ts">
// The shared tooltip's item card inside a panel: plain, with stats that grow per level (a third column, only when a
// stat has `per`), and in a module's skin. The skin is the one the module gives sdk.ui.tooltip.defineSkin, with its
// files as URLs here instead of paths in dist/.
import type { TooltipContent } from "@tavora/sdk";
import { ItemCard, type ItemCardSkin } from "@tavora/official-ui/components/ui/item-card";
import frame from "../../assets/card-frame.png?url";

const tower: TooltipContent = {
  title: "Archer Tower",
  subtitle: "Tower · Level 2",
  layout: "card",
  badges: ["Rare"],
  effect: [{ text: "Shoots the nearest enemy for " }, { text: "12", accent: true }, { text: " damage every " }, { text: "1.5 s", accent: true }, { text: "." }],
  properties: [{ label: "Range", value: "3 plots" }, { label: "Cost", value: "40 gold" }],
};
const levels: TooltipContent = {
  ...tower,
  perHeading: "Per level",
  properties: [{ label: "Damage", value: "12", per: "+3" }, { label: "Attack speed", value: "", per: "×1.1" }, { label: "Range", value: "3 plots" }],
};
const skin: ItemCardSkin = {
  frame: { image: frame, slice: [6, 6, 6, 6] },
  // rules-allow: color a skin's own game colours, fixed in every theme like a game's card
  colors: { surface: "#1e1610", text: "#f4e6c8", muted: "#c9b48e", accent: "#f0c86e", box: "#2c2016", boxText: "#f4e6c8", boxBorder: "#a07c40" },
  pixelArt: true,
  titleCaps: true,
};
</script>

<template>
  <div class="flex flex-wrap items-start gap-4">
    <ItemCard :content="tower" />
    <ItemCard :content="levels" />
    <ItemCard :content="levels" :skin="skin" />
  </div>
</template>
