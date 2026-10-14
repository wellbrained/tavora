<script setup lang="ts">
import { cn } from "@/lib/utils";

// One setting: its name and a sentence on what it does, with the control on
// the right. Rows are separated by dividers, not boxed in cards. `setting`
// is its id in settings-index.ts, which search results lead to.
defineProps<{ label: string; description?: string; setting?: string; highlighted?: boolean }>();
</script>

<template>
  <div
    :class="
      cn(
        '-mx-3 flex min-h-16 items-center gap-6 rounded-lg border-b px-3 py-4 transition-colors duration-500 last:border-b-0',
        highlighted && 'bg-primary/10',
      )
    "
    :data-setting="setting"
    :data-highlighted="highlighted || undefined"
  >
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <span class="font-medium">{{ label }}</span>
      <span v-if="description" class="text-muted-foreground">{{ description }}</span>
    </div>
    <slot />
  </div>
</template>
