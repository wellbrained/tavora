<script setup lang="ts">
// One card (a TooltipContent), described once, in two places: the panel's own tooltip (ItemTooltip) and Tavora's
// shared tooltip above the workspace, which a big card needs so it is never cut off at the panel's edge.
// `useTooltip({ shared })` sends it there; with `pin`, a click on something that isn't a control (the name here) pins
// the card. `shared` takes a function because the SDK comes once the panel is connected.
import type { TooltipContent } from "@tavora/sdk";
import { useTooltip } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ItemTooltip } from "@tavora/official-ui/components/ui/item-card";
import { useSdk } from "../../sdk";

const tower: TooltipContent = {
  title: "Archer Tower",
  subtitle: "Tower · Level 2",
  layout: "card",
  badges: ["Rare"],
  effect: [{ text: "Shoots the nearest enemy for " }, { text: "12", accent: true }, { text: " damage every " }, { text: "1.5 s", accent: true }, { text: "." }],
  properties: [{ label: "Range", value: "3 plots" }, { label: "Cost", value: "40 gold" }],
};

const sdk = useSdk();
const panel = useTooltip<TooltipContent>({ side: "right" });
const shared = useTooltip({ shared: () => sdk.value?.ui.tooltip, pin: true });
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <Button variant="outline" v-bind="panel.on(tower)" hinted>In the panel</Button>
    <Button variant="outline" v-bind="shared.on(tower)" hinted>In Tavora's tooltip</Button>
    <span class="text-sm underline decoration-dotted underline-offset-4" v-bind="shared.on(tower, { focusable: true })">Archer Tower</span>
  </div>
  <ItemTooltip v-bind="panel.props" :content="panel.content" />
</template>
