<script setup lang="ts">
// The shared tooltip's unit card inside a panel: a game unit as games show it on the board, plain in the theme's
// colours and in two skins with their own title bar. The extreme one has long values with suffixes, three spells with
// counts and a level over the most. The pictures are the ones a module gives sdk.ui.tooltip, as URLs here.
import type { TooltipContent } from "@tavora/sdk";
import { ItemCard, type ItemCardSkin } from "@tavora/official-ui/components/ui/item-card";
import archer from "../../assets/unit-archer.png?url";
import knight from "../../assets/unit-knight.png?url";
import person from "../../assets/unit-count.png?url";
import shield from "../../assets/spell-shield.png?url";
import bolt from "../../assets/spell-bolt.png?url";
import flame from "../../assets/spell-flame.png?url";

const normal: TooltipContent = {
  title: "Archer",
  layout: "unit",
  image: archer,
  corner: { text: "27", icon: person },
  effect: "Shoots the nearest enemy from the back row.",
  properties: [
    { label: "Health:", value: "18.8" },
    { label: "Damage:", value: "16.9" },
    { label: "Hits/Second:", value: "0.5" },
    { label: "Move Speed:", value: "2.3" },
    { label: "Crit Chance:", value: "100%" },
  ],
  icons: [{ image: shield, label: "Iron Shield" }],
  pips: { filled: 3, total: 3 },
};
const extreme: TooltipContent = {
  title: "Knight",
  layout: "unit",
  image: knight,
  corner: { text: "1800", icon: person },
  effect: [{ text: "Holds the front line. Gains " }, { text: "+1%", accent: true }, { text: " damage for each new unit." }],
  properties: [
    { label: "Health:", value: "3.95", suffix: "E+12" },
    { label: "Damage:", value: "1.13", suffix: "E+15" },
    { label: "Hits/Second:", value: "99.999", suffix: " (MAX)" },
    { label: "Move Speed:", value: "5347903.9" },
    { label: "Crit Chance:", value: "5%" },
  ],
  icons: [
    { image: shield, label: "Iron Shield", count: "95" },
    { image: bolt, label: "Spark", count: "68" },
    { image: flame, label: "Ember", count: "78" },
  ],
  pips: { filled: 3, total: 3, extra: "+67" },
};
// rules-allow: color a skin's own game colours, fixed in every theme like a game's card
const gold: ItemCardSkin = { colors: { surface: "#1a150f", text: "#ececec", accent: "#f2c94c", bar: "#776538" }, pixelArt: true };
// rules-allow: color a skin's own game colours, fixed in every theme like a game's card
const teal: ItemCardSkin = { colors: { surface: "#1a150f", text: "#ececec", accent: "#6bc3ad", bar: "#4f6e6b" }, pixelArt: true };
</script>

<template>
  <div class="flex flex-wrap items-start gap-6">
    <ItemCard :content="normal" />
    <ItemCard :content="normal" :skin="gold" />
    <ItemCard :content="extreme" :skin="teal" />
  </div>
</template>
