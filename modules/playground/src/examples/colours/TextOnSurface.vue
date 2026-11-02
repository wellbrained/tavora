<script setup lang="ts">
// A surface and the text colour made for it. Every pair is read together, so each one stays readable in any theme.
const PAIRS: [surface: string, text: string][] = [
  ["bg-background", "text-foreground"],
  ["bg-card", "text-card-foreground"],
  ["bg-popover", "text-popover-foreground"],
  ["bg-primary-fill", "text-primary-fill-foreground"],
  ["bg-primary", "text-primary-foreground"],
  ["bg-secondary", "text-secondary-foreground"],
  ["bg-muted", "text-muted-foreground"],
  ["bg-accent", "text-accent-foreground"],
  ["bg-toast", "text-toast-foreground"],
  ["bg-card", "text-primary"],
];
</script>

<template>
  <div class="grid grid-cols-[repeat(auto-fill,minmax(min(17rem,100%),1fr))] gap-2">
    <div v-for="[surface, text] in PAIRS" :key="`${surface} ${text}`" class="flex items-center gap-3 rounded-md border px-3 py-2" :class="[surface, text]">
      <span class="text-lg font-semibold">Aa</span>
      <span class="flex min-w-0 flex-col font-mono text-xs">
        <span class="truncate">{{ surface }}</span>
        <span class="truncate">{{ text }}</span>
      </span>
    </div>
  </div>
</template>
