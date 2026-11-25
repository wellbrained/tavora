<script setup lang="ts">
// A big card in Tavora's shared tooltip, above the workspace, so it is never cut off at the panel's edge:
// `useTooltip({ shared })` sends the card (a TooltipContent) there instead of to a Tooltip in the panel. With `pin`, a
// click on something that isn't a control (the name here) pins the card; on a button a click only does what it does.
// `shared` takes a function because the SDK comes once the panel is connected.
import type { TooltipContent } from "@tavora/sdk";
import { useTooltip } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { useSdk } from "../../sdk";

const sdk = useSdk();
const tip = useTooltip({ shared: () => sdk.value?.ui.tooltip, pin: true });

const tower: TooltipContent = {
  title: "Archer Tower",
  subtitle: "Tower · Level 2",
  layout: "card",
  badges: ["Rare"],
  effect: [{ text: "Shoots the nearest enemy for " }, { text: "12", accent: true }, { text: " damage every " }, { text: "1.5 s", accent: true }, { text: "." }],
  properties: [{ label: "Range", value: "3 plots" }, { label: "Cost", value: "40 gold" }],
};
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <Button variant="outline" v-bind="tip.on(tower)" hinted>Build Archer Tower</Button>
    <span class="text-sm underline decoration-dotted underline-offset-4" v-bind="tip.on(tower, { focusable: true })">Archer Tower</span>
  </div>
</template>
