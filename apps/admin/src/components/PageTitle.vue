<script setup lang="ts">
defineProps<{ title: string; hint?: string }>();
</script>

<template>
  <header class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-xl font-semibold">{{ title }}</h1>
      <p v-if="hint" class="text-muted-foreground text-sm">{{ hint }}</p>
    </div>
    <div v-if="$slots.default" class="flex flex-none items-center gap-2"><slot /></div>
  </header>
</template>
