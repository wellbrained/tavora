<script setup lang="ts">
import { Cpu, Gpu } from "@lucide/vue";
import { Sparkline } from "@tavora/official-ui/components/ui/sparkline";
import { StatStrip, StatTile } from "@tavora/official-ui/components/ui/stat-tile";

const values = [30, 34, 38, 33, 28, 31, 40, 44, 39, 35, 30, 27, 31, 36, 34];
</script>

<template>
  <StatStrip variant="outlined" class="max-w-2xl" :columns="2">
    <StatTile :value="34" unit="%" label="CPU · Ryzen 7" size="xl" align="center" :second-value="52" second-unit="°C" second-hint="No reading yet.">
      <template #icon><Cpu /></template>
      <template #graph><Sparkline :values="values" :height="40" label="CPU" /></template>
      <template #footer><span class="flex justify-between gap-2"><span>max 61 %</span><span>16 threads</span></span></template>
    </StatTile>
    <StatTile :value="25" unit="%" label="Graphics · RTX" size="xl" align="center" second-value="" second-unit="°C" second-hint="Only some cards report it.">
      <template #icon><Gpu /></template>
      <template #graph><Sparkline :values="values" :height="40" label="Graphics" /></template>
      <template #footer><span class="flex justify-between gap-2"><span>max 40 %</span><span>VRAM 8.6 / 12 GB</span></span></template>
    </StatTile>
  </StatStrip>
</template>
