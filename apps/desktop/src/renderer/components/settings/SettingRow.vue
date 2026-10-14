<script setup lang="ts">
// One setting: its name and a sentence on what it does, with the control on
// the right. Rows are separated by dividers, not boxed in cards.
defineProps<{ label: string; description?: string }>();
</script>

<template>
  <div class="flex min-h-16 items-center gap-6 border-b py-4 last:border-b-0">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <span class="font-medium">{{ label }}</span>
      <span v-if="description" class="text-muted-foreground">{{ description }}</span>
    </div>
    <slot />
  </div>
</template>
