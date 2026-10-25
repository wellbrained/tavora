<script setup lang="ts">
// The graph under the CPU and GPU numbers: the last 5 minutes (History.values(), oldest first, 0 to 100) as a kit
// Sparkline. The parent hands over a fresh array with each snapshot, which is what makes it redraw, and only then.
import { Sparkline } from "@tavora/official-ui/components/ui/sparkline";

defineProps<{ values: number[]; label: string }>();
</script>

<template>
  <Sparkline :values="values" :height="40" :label="label" data-testid="graph" />
</template>
