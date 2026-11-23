<script setup lang="ts">
// The shared tooltip's item card inside a panel: plain, with stats that grow per level (a third column, only when a
// stat has `per`) and icons before some of their labels, in a module's skin, and with a column per level (`columns`
// and `more`), and in a skin with tags over its picture (`artTags`). The skin, the picture and the icons are the ones
// the module gives sdk.ui.tooltip, with their files as URLs here instead of paths in dist/.
import type { TooltipContent } from "@tavora/sdk";
import { ItemCard, type ItemCardSkin } from "@tavora/official-ui/components/ui/item-card";
import frame from "../../assets/card-frame.png?url";
import knight from "../../assets/card-knight.png?url";
import heart from "../../assets/stat-heart.png?url";
import stopwatch from "../../assets/stat-stopwatch.png?url";
import sword from "../../assets/stat-sword.png?url";

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
  // Only the icons' shape counts: the card draws them in the label's colour. Range has none and still lines up.
  properties: [{ label: "Health", value: "40", per: "+8", icon: heart }, { label: "Damage", value: "12", per: "+3", icon: sword }, { label: "Attack speed", value: "", per: "×1.1", icon: stopwatch }, { label: "Range", value: "3 plots" }],
};
// Extra value columns: each stat at level 1, 2 and 3 under their headings. Stats without extra values leave those cells
// empty, and a long label wraps instead of squeezing the numbers.
const squad: TooltipContent = {
  title: "Archer Squad",
  subtitle: "Unit · Kingdom of Nothing",
  layout: "card",
  columns: ["Lv 1", "Lv 2", "Lv 3"],
  properties: [
    { label: "Units", value: "6", more: ["12", "18"] },
    { label: "HP", value: "16", more: ["20.8", "27"], icon: heart },
    { label: "Damage", value: "6", more: ["7.2", "8.6"], icon: sword },
    { label: "Attack speed", value: "0.6", icon: stopwatch },
    { label: "Crit chance", value: "5%" },
    { label: "Move speed", value: "1.6", more: ["1.8", "1.9"] },
  ],
};
const skin: ItemCardSkin = {
  frame: { image: frame, slice: [6, 6, 6, 6] },
  // rules-allow: color a skin's own game colours, fixed in every theme like a game's card
  colors: { surface: "#1e1610", text: "#f4e6c8", muted: "#c9b48e", accent: "#f0c86e", box: "#2c2016", boxText: "#f4e6c8", boxBorder: "#a07c40" },
  pixelArt: true,
  titleCaps: true,
};
// Tags over the picture: the kind at its bottom left, the rarity in its own colour at its bottom right. A "–" in a
// level column means the stat doesn't change there, and is drawn faint.
const knightCard: TooltipContent = {
  title: "Paladin",
  subtitle: "Troop · Kingdom of Stone",
  layout: "card",
  image: knight,
  badges: ["Troop"],
  // rules-allow: color a module's own rarity colour, fixed in every theme like a game's card
  artTags: [{ text: "Stone", side: "left" }, { text: "Legendary", color: "#f0a640", side: "right" }],
  columns: ["Lv 1", "Lv 2", "Lv 3"],
  properties: [
    { label: "Units", value: "4", more: ["6", "8"] },
    { label: "HP", value: "30", more: ["39", "50"], icon: heart },
    { label: "Damage", value: "9", more: ["–", "12"], icon: sword },
    { label: "Range", value: "1", more: ["–", "–"] },
  ],
};
</script>

<template>
  <div class="flex flex-wrap items-start gap-4">
    <ItemCard :content="tower" />
    <ItemCard :content="levels" />
    <ItemCard :content="levels" :skin="skin" />
    <ItemCard :content="squad" />
    <ItemCard :content="knightCard" :skin="skin" />
  </div>
</template>
