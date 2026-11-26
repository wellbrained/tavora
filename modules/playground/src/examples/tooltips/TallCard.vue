<script setup lang="ts">
// A card taller than the panel: it is held inside, and the wheel over the button scrolls it.
import type { TooltipContent } from "@tavora/sdk";
import { useTooltip } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ItemTooltip } from "@tavora/official-ui/components/ui/item-card";

const card: TooltipContent = {
  title: "Rime Whisper",
  subtitle: "Frigid Wand",
  layout: "card",
  properties: Array.from({ length: 40 }, (_, at) => ({ label: `Modifier ${at + 1}`, value: `+${(at + 1) * 3}` })),
};
const tip = useTooltip<TooltipContent>({ side: "right" });
</script>

<template>
  <Button variant="outline" v-bind="tip.on(card)" hinted>Hover and scroll</Button>
  <ItemTooltip v-bind="tip.props" :content="tip.content" />
</template>
