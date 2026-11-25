<script setup lang="ts">
// Values in a tooltip: a chart's bars and a game item. The bars aren't buttons: `focusable` lets the keyboard reach
// them, so their values show by keyboard too.
import { Tooltip, TooltipRows, useTooltip, type TooltipRow } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const bars = [40, 55, 35, 80, 60, 45, 70];
const chartRows: TooltipRow[] = [{ label: "Play time", value: "3 h 12 min" }, { label: "vs. last week", value: "+48 min", trend: "better" }];
const itemRows: TooltipRow[] = [{ label: "Damage", value: "142" }, { label: "Crit chance", value: "+8%", trend: "better" }, { label: "Stamina use", value: "+12%", trend: "worse" }];

const chart = useTooltip<string>({ side: "top" });
const item = useTooltip<"bow">({ side: "right" });
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div class="flex h-16 items-end gap-1.5" role="list" aria-label="Play time this week">
      <div
        v-for="(height, index) in bars"
        :key="index"
        role="listitem"
        class="bg-primary/30 hover:bg-primary focus-visible:bg-primary w-6 rounded-t-sm"
        :style="{ height: height + '%' }"
        :aria-label="days[index]"
        v-bind="chart.on(days[index], { focusable: true })"
      />
    </div>
    <Button variant="outline" class="size-12 text-xl" aria-label="Wolfbane Longbow" v-bind="item.on('bow')" hinted>🏹</Button>
  </div>
  <Tooltip v-bind="chart.props" :title="chart.content ?? ''"><TooltipRows :rows="chartRows" /></Tooltip>
  <Tooltip v-bind="item.props" title="Wolfbane Longbow" description="Ranged · Level 25" divider>
    <TooltipRows :rows="itemRows" /><hr /><p>Arrows pierce the first enemy.</p>
  </Tooltip>
</template>
