<script setup lang="ts">
// `look: "poe"` on an item card: the Path of Exile 2 look, drawn in a panel as Tavora's shared tooltip draws it. The
// title takes its rarity's colour (`tone`: normal, magic, rare or unique), the requirements sit under the picture, and a
// row's status and affix tags follow it. Ask for it only for items that look like that in the game.
import type { TooltipContent } from "@tavora/sdk";
import { ItemCard } from "@tavora/official-ui/components/ui/item-card";
import knight from "../../assets/card-knight.png?url";

const rare: TooltipContent = {
  look: "poe",
  tone: "rare",
  title: "Doom Loop",
  subtitle: "Ultimate Robe",
  image: knight,
  badges: ["ilvl 82", "Quality: +20%"],
  requirements: [{ label: "Level", value: "65" }, { label: "Int", value: "121" }],
  properties: [{ label: "Energy Shield", value: "312" }, { label: "Evasion Rating", value: "184" }],
  sections: [
    { title: "Implicit", rows: [{ text: "+30 to Spirit" }] },
    { rows: [{ text: "+98 to maximum Energy Shield", badges: ["[P1]"], status: "Crafted" }, { text: "42% increased Energy Shield", badges: ["[P2]"], connected: true }, { text: "+38% to Fire Resistance", badges: ["[S3]"] }] },
  ],
};
const unique: TooltipContent = { look: "poe", tone: "unique", title: "Tabula Rasa", subtitle: "Simple Robe", image: knight, badges: ["ilvl 70"], sections: [{ rows: [{ text: "Has 6 sockets" }, { text: "Corrupted" }] }] };
const magic: TooltipContent = { look: "poe", tone: "magic", title: "Glowing Robe of the Lynx", subtitle: "Simple Robe", properties: [{ label: "Evasion Rating", value: "96" }], sections: [{ rows: [{ text: "+12% to Lightning Resistance", badges: ["[S7]"] }] }] };
</script>

<template>
  <div class="flex flex-wrap items-start gap-4">
    <ItemCard :content="rare" requires-label="Requires" />
    <ItemCard :content="unique" />
    <ItemCard :content="magic" />
  </div>
</template>
