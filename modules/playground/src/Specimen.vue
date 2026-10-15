<script setup lang="ts">
// A labelled row of examples inside a section.
defineProps<{ label: string; column?: boolean }>();
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="text-muted-foreground text-xs">{{ label }}</p>
    <div :class="column ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-2'">
      <slot />
    </div>
  </div>
</template>
