<script setup lang="ts">
// A card of your own from the tooltip's freestanding parts, each taking plain values: an art header with a picture
// (TooltipArt), text with bold, italic and accented runs and a line break (TooltipText), a heading over a list with
// meta text (TooltipHeading, TooltipList), tags (TooltipTags), a row of small pictures with counts (TooltipIcons) and a
// footer line (TooltipFooter). They go in the panel's Tooltip, or in an ItemCard's slot between its own parts.
import { Tooltip, TooltipArt, TooltipFooter, TooltipHeading, TooltipIcons, TooltipList, TooltipTags, TooltipText, useTooltip } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import bolt from "../../assets/spell-bolt.png?url";
import flame from "../../assets/spell-flame.png?url";
import shield from "../../assets/spell-shield.png?url";

const tip = useTooltip<"skill" | "relic">({ side: "right" });
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button variant="outline" v-bind="tip.on('skill')" hinted>Storm Call</Button>
    <Button variant="outline" v-bind="tip.on('relic')" hinted>Ember Relic</Button>
  </div>
  <Tooltip v-bind="tip.props" :width="tip.content === 'skill' ? 'md' : 'sm'">
    <template v-if="tip.content === 'skill'">
      <TooltipArt title="Storm Call" subtitle="Unlocked · 2/3" :image="bolt" />
      <TooltipText :runs="[{ text: 'Your next 3 attacks deal ' }, { text: '+40%', accent: true }, { text: ' lightning damage.' }]" />
      <TooltipText :runs="[{ text: 'Stacks with Static.', italic: true }, { text: '\nLasts ' }, { text: '8 s', strong: true }, { text: '.' }]" />
      <TooltipHeading text="Works with" />
      <TooltipIcons :icons="[{ image: flame, label: 'Flame' }, { image: shield, label: 'Shield', count: '3' }]" />
      <TooltipFooter><strong>Skill points:</strong> 1 per rank</TooltipFooter>
    </template>
    <template v-else-if="tip.content === 'relic'">
      <TooltipArt title="Ember Relic" subtitle="Relic · Fire" />
      <TooltipText box :runs="[{ text: 'Burning enemies take ' }, { text: '+15%', accent: true }, { text: ' damage.' }]" />
      <TooltipTags :tags="['Fire', 'Epic']" />
      <TooltipHeading text="Found in" />
      <TooltipList :items="[{ text: 'Ashen Caves', meta: 'Common' }, { text: 'Sunken Halls', meta: 'Rare' }]" />
      <TooltipText tone="muted" size="small" text="You have 2 of these." />
    </template>
  </Tooltip>
</template>
