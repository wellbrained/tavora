<script setup lang="ts">
// A rich tooltip for several buttons: `useTooltip` shows one card beside whichever you hover or reach by keyboard.
// Each button binds `tip.on(card)`; the one Tooltip binds `tip.props` and the card. `hinted` tells the button that a
// tooltip is shown for it.
import { CircleHelp } from "@lucide/vue";
import { Tooltip, useTooltip } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";

interface Hint {
  title: string;
  description: string;
  shortcut?: string;
  tone?: "warning";
}
const tip = useTooltip<Hint>();
const help: Hint = { title: "Start with Windows", description: "Tavora opens quietly in the tray when you sign in. Your overlays are ready when the game starts." };
const rich: Hint = { title: "A place worth exploring", shortcut: "Ctrl+K", description: "Readable text that wraps in narrow panels." };
const warning: Hint = { title: "Almost at your limit", tone: "warning", description: "Resets Friday at 09:00. You can still use 8% this week." };
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="ghost" size="icon-sm" aria-label="About starting with Windows" v-bind="tip.on(help)" hinted><CircleHelp /></Button>
    <Button variant="secondary" v-bind="tip.on(rich)" hinted>Rich tooltip</Button>
    <Button variant="outline" class="text-warning" v-bind="tip.on(warning)" hinted>92% used</Button>
  </div>
  <Tooltip v-bind="{ ...tip.props, ...tip.content }" />
</template>
