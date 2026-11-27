<script setup lang="ts">
// Formatting in a card (a TooltipContent), the same in the panel and in Tavora's shared tooltip: bold and italic runs
// and line breaks in the effect, `blocks` after the sections (a paragraph, a heading, a list, tags, drawn by the kit's
// TooltipText, TooltipHeading, TooltipList and TooltipTags) and a `footer` line with a bold label (TooltipFooter).
// Inline it is an ItemCard; the buttons show it in the panel's tooltip and in Tavora's.
import type { TooltipContent } from "@tavora/sdk";
import { useTooltip } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ItemCard, ItemTooltip } from "@tavora/official-ui/components/ui/item-card";
import { useSdk } from "../../sdk";

const skill: TooltipContent = {
  title: "Multi Shot",
  subtitle: "Unlocked",
  layout: "card",
  effect: [
    { text: "Shooting " },
    { text: "Regular Arrows", italic: true },
    { text: " has a " },
    { text: "20%", accent: true, strong: true },
    { text: " chance to spawn a Flurry of Arrows.\n\nIt doesn't trigger on " },
    { text: "Special Arrows", italic: true },
    { text: "." },
  ],
  blocks: [
    { type: "text", runs: [{ text: "Practice makes the arrow fly true.", italic: true }], tone: "muted" },
    { type: "heading", text: "Found in" },
    { type: "list", items: ["Hunter's tree", { text: "Ranger's tree", meta: "Tier 2" }] },
    // rules-allow: color a module's own rarity colour, fixed in every theme like a game's card
    { type: "tags", tags: ["Bow", { text: "Legendary", color: "#e0a243" }] },
  ],
  footer: [{ text: "Skill points: ", strong: true }, { text: "3" }],
};

const sdk = useSdk();
const panel = useTooltip<TooltipContent>({ side: "right" });
const shared = useTooltip<TooltipContent>({ shared: () => sdk.value?.ui.tooltip, pin: true, fallback: true });
</script>

<template>
  <div class="flex flex-wrap items-start gap-4">
    <ItemCard :content="skill" />
    <div class="flex flex-col items-start gap-3">
      <Button variant="outline" v-bind="panel.on(skill)" hinted>In the panel</Button>
      <Button variant="outline" v-bind="shared.on(skill)" hinted>In Tavora's tooltip</Button>
    </div>
  </div>
  <ItemTooltip v-bind="panel.props" :content="panel.content" />
  <ItemTooltip v-bind="shared.props" :content="shared.content" />
</template>
