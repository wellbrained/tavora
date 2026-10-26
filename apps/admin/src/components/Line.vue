<script setup lang="ts">
// One row in a Group: an optional picture, a title with a small line under it, badges and buttons.
defineProps<{ title: string; sub?: string }>();
</script>

<template>
  <div class="flex min-h-12 items-center gap-3 px-3 py-2">
    <div v-if="$slots.lead" class="flex-none"><slot name="lead" /></div>
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium" :title="title">{{ title }}</p>
      <p v-if="sub" class="text-muted-foreground truncate text-xs" :title="sub">{{ sub }}</p>
      <slot />
    </div>
    <div v-if="$slots.badges" class="flex flex-none flex-wrap items-center justify-end gap-1"><slot name="badges" /></div>
    <div v-if="$slots.actions" class="flex flex-none items-center gap-1.5"><slot name="actions" /></div>
  </div>
</template>
