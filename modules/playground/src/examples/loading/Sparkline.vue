<script setup lang="ts">
import { Sparkline } from "@tavora/official-ui/components/ui/sparkline";

const values = Array.from({ length: 60 }, (_, i) => Math.round(50 + 30 * Math.sin(i / 5) + 12 * Math.sin(i * 1.7)));
</script>

<template>
  <div class="flex flex-col gap-2">
    <Sparkline :values="values" class="max-w-64" label="Usage over the last minute" />
    <Sparkline :values="values" color="success" :height="24" class="max-w-64" label="Usage, short and green" />
  </div>
</template>
