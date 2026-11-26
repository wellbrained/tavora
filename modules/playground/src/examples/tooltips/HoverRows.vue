<script setup lang="ts">
// Rows and tiles that show a card on hover or keyboard focus but aren't buttons: HoverRow holds anything (here a skill
// with a bar and its numbers), StatTile `hoverable` does the same for a tile in a strip. Bind the card with `tip.on`.
// They light up like a ghost Button and take the focus ring, without moving or growing.
import { Tooltip, TooltipRows, useTooltip, type TooltipRow } from "@tavora/official-ui";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { HoverRow } from "@tavora/official-ui/components/ui/hover-row";
import { StatStrip, StatTile } from "@tavora/official-ui/components/ui/stat-tile";

interface Skill {
  name: string;
  level: number;
  damage: string;
  share: number;
  hits: string;
}
const skills: Skill[] = [
  { name: "Fireball", level: 3, damage: "12,480", share: 0.34, hits: "212" },
  { name: "Chain Lightning", level: 2, damage: "8,910", share: 0.24, hits: "540" },
];
const tip = useTooltip<{ title: string; rows: TooltipRow[] }>({ side: "right" });
const cardOf = (skill: Skill) => ({
  title: skill.name,
  rows: [
    { label: "Damage", value: skill.damage },
    { label: "Share", value: String(Math.round(skill.share * 100)), unit: "%" },
    { label: "Hits", value: skill.hits },
  ],
});
const totals = { title: "Runs", rows: [{ label: "Won", value: "18" }, { label: "Lost", value: "6" }] };
</script>

<template>
  <div class="flex max-w-sm flex-col gap-4">
    <ul class="m-0 flex list-none flex-col gap-3 p-0">
      <HoverRow v-for="skill in skills" :key="skill.name" as="li" class="flex flex-col gap-1" v-bind="tip.on(cardOf(skill))">
        <div class="flex items-center gap-2 text-sm">
          <span class="font-medium">{{ skill.name }}</span>
          <Badge variant="outline">Lv {{ skill.level }}</Badge>
          <span class="text-muted-foreground ml-auto tabular-nums">{{ skill.damage }}</span>
        </div>
        <div class="bg-muted h-1.5 overflow-hidden rounded-full"><div class="bg-primary h-full" :style="{ width: skill.share * 100 + '%' }" /></div>
      </HoverRow>
    </ul>
    <StatStrip>
      <StatTile :value="24" label="Runs" hoverable v-bind="tip.on(totals)" />
      <StatTile :value="75" unit="%" label="Win rate" hoverable v-bind="tip.on(totals)" />
    </StatStrip>
  </div>
  <Tooltip v-bind="tip.props" :title="tip.content?.title ?? ''" divider>
    <TooltipRows v-if="tip.content" :rows="tip.content.rows" />
  </Tooltip>
</template>
