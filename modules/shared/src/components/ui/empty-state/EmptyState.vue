<script setup lang="ts">
// What an empty list shows instead of nothing: an icon, a title, one line and maybe a button.
import type { HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

defineProps<{ title: string; description?: string; class?: HTMLAttributes["class"] }>();
</script>

<template>
  <div data-slot="empty-state" :class="cn('flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center', $props.class)">
    <div v-if="$slots.icon" class="text-muted-foreground [&_svg]:size-6" aria-hidden="true"><slot name="icon" /></div>
    <div class="flex flex-col gap-1">
      <p class="text-sm font-medium">{{ title }}</p>
      <p v-if="description" class="text-muted-foreground text-sm">{{ description }}</p>
    </div>
    <div v-if="$slots.action"><slot name="action" /></div>
  </div>
</template>
