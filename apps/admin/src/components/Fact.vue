<script setup lang="ts">
// A label with its value on the right, optionally followed by a badge: for key numbers and checks.
defineProps<{ label: string; value?: string | number; hint?: string }>();
</script>

<template>
  <div class="flex min-h-10 items-center gap-3 px-3 py-2 text-sm">
    <div class="min-w-0 flex-1">
      <p class="truncate">{{ label }}</p>
      <p v-if="hint" class="text-muted-foreground truncate text-xs">{{ hint }}</p>
    </div>
    <span v-if="value !== undefined" class="flex-none font-medium tabular-nums">{{ value }}</span>
    <slot />
  </div>
</template>
