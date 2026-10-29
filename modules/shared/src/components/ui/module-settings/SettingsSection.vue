<script setup lang="ts">
// A few rows that belong together under a small heading, such as Text or Background.
defineProps<{ title?: string }>();
</script>

<template>
  <section class="mt-6" :aria-label="title" data-slot="settings-section">
    <h3 v-if="title" class="text-muted-foreground mb-1 text-xs font-semibold tracking-wider uppercase">{{ title }}</h3>
    <div class="flex flex-col"><slot /></div>
  </section>
</template>
