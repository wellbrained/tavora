<script setup lang="ts">
// What an empty list shows instead of nothing: an icon, a title, one line and maybe a button.
// `framed` (the default) draws a dashed frame around it, for an empty spot among other content; `bare` has no frame, for a
// panel or a list that is empty as a whole. `fill` takes the free height of a column it sits in and centres itself there.
import type { HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

const props = withDefaults(
  defineProps<{ title: string; description?: string; variant?: "framed" | "bare"; fill?: boolean; class?: HTMLAttributes["class"] }>(),
  { variant: "framed", fill: false },
);
</script>

<template>
  <div
    data-slot="empty-state"
    :data-variant="variant"
    :class="
      cn(
        'flex flex-col items-center gap-3 px-4 py-10 text-center',
        variant === 'framed' && 'rounded-lg border border-dashed',
        fill && 'min-h-0 flex-1 justify-center',
        props.class,
      )
    "
  >
    <div v-if="$slots.icon" class="text-muted-foreground [&_svg]:size-6" aria-hidden="true"><slot name="icon" /></div>
    <div class="flex flex-col gap-1">
      <p class="text-sm font-medium">{{ title }}</p>
      <p v-if="description" class="text-muted-foreground text-sm">{{ description }}</p>
    </div>
    <div v-if="$slots.action" class="flex w-full justify-center"><slot name="action" /></div>
  </div>
</template>
