<script setup lang="ts">
// The one setting a page is about, at its top: an overlay's on/off switch, or its main action.
defineProps<{ label: string; hint?: string }>();
</script>

<template>
  <div class="bg-background mt-4 flex items-center gap-3 rounded-lg border py-3 pr-3 pl-4" data-slot="settings-main-bar">
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium">{{ label }}</p>
      <p v-if="hint" class="text-muted-foreground mt-0.5 text-xs">{{ hint }}</p>
    </div>
    <div class="flex flex-none items-center gap-2"><slot /></div>
  </div>
</template>
