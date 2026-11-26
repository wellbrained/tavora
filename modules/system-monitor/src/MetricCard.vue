<script setup lang="ts">
// A card for CPU, the graphics card or memory, on the kit's StatTile: the usage big and centred (with the temperature
// next to it), the label and name under it, the graph, and one small line with the peak on the left and a detail on the
// right. Plain text, so a snapshot touches only what changed.
import { StatTile } from "@tavora/official-ui/components/ui/stat-tile";
import type { Component } from "vue";
import UsageGraph from "./UsageGraph.vue";

withDefaults(defineProps<{
  title: string;
  name: string;
  /** The number, already written ("42"); empty before the first numbers. */
  usage: string;
  /** Already written ("72"), in degrees Celsius; empty until Tavora reports it (it sits centred next to the %). */
  temperature?: string;
  /** A text colour class for the temperature (yellow, red when it runs hot); empty for the normal colour. */
  temperatureClass?: string;
  /** False for a block that has no temperature (memory): the usage is then centred alone. */
  hasTemperature?: boolean;
  /** A small picture in the corner (when the card has no action there). */
  icon?: Component;
  /** Hover text for the dash shown while there is no temperature. */
  temperatureHint?: string;
  /** Already written ("max 90 %"); empty when not shown. */
  peak: string;
  /** Already written ("VRAM 9.4 / 9.8 GB · 310 W"). */
  detail: string;
  /** Shown on hover. */
  hint: string;
  values: number[];
  graphLabel: string;
  testid: string;
}>(), { hasTemperature: true });
</script>

<template>
  <StatTile
    variant="outlined"
    size="xl"
    align="center"
    class="bg-card text-card-foreground rounded-lg p-2.5"
    :value="usage"
    unit="%"
    :label="`${title} · ${name}`.replace(/ · $/, '')"
    :second-value="hasTemperature ? temperature || '' : undefined"
    second-unit="°C"
    :second-hint="temperatureHint"
    :second-class="temperature ? temperatureClass : undefined"
    :data-testid="testid"
    :title="hint || undefined"
    :tabindex="hint ? 0 : undefined"
  >
    <!-- The corner: a small button when the card has one (the Memory card's apps), else a picture of what it measures. -->
    <template #icon><slot name="action"><component :is="icon" v-if="icon" aria-hidden="true" /></slot></template>
    <template #graph><UsageGraph :values="values" :label="graphLabel" /></template>
    <template #footer>
      <span class="flex items-baseline justify-between gap-2 tabular-nums">
        <span class="min-w-0 truncate" data-testid="peak">{{ peak }}</span>
        <span class="truncate" data-testid="detail">{{ detail }}</span>
      </span>
    </template>
  </StatTile>
</template>
