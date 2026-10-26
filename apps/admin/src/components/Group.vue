<script setup lang="ts">
// A titled block of rows: the one shape every section is made of (no card grids).
defineProps<{ title?: string; hint?: string }>();
</script>

<template>
  <section class="flex flex-col gap-2">
    <div v-if="title || $slots.actions" class="flex items-end justify-between gap-3">
      <div class="min-w-0">
        <h2 v-if="title" class="text-sm font-semibold">{{ title }}</h2>
        <p v-if="hint" class="text-muted-foreground text-xs">{{ hint }}</p>
      </div>
      <div v-if="$slots.actions" class="flex flex-none items-center gap-2"><slot name="actions" /></div>
    </div>
    <div class="bg-card divide-y overflow-hidden rounded-lg border"><slot /></div>
  </section>
</template>
