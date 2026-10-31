<script setup lang="ts">
// A small picture of a theme drawn with its own colours: rail, window, a card with text and the primary button,
// and a toast pill. "sm" is the closed theme choice, "md" a row in its list.
import type { ThemeVariationView } from "../../../shared/host-api";

defineProps<{ variation: ThemeVariationView; size: "sm" | "md" }>();
</script>

<template>
  <span
    v-if="size === 'md'"
    class="flex h-16 w-28 flex-none overflow-hidden rounded-md border"
    :style="{ background: variation.colors.background, borderColor: variation.colors.border }"
    aria-hidden="true"
  >
    <span class="flex w-5 flex-none flex-col items-center gap-1 pt-2" :style="{ background: variation.colors.rail }">
      <span class="size-2.5 rounded-[3px]" :style="{ background: variation.colors.primary }" />
      <span class="size-2.5 rounded-[3px]" :style="{ background: variation.colors.secondary }" />
      <span class="size-2.5 rounded-[3px]" :style="{ background: variation.colors.secondary }" />
    </span>
    <span class="relative flex flex-1 p-1.5">
      <span
        class="flex flex-1 flex-col gap-1 border p-1.5"
        :style="{ background: variation.colors.card, borderColor: variation.colors.border, borderRadius: `${variation.radius / 2}px` }"
      >
        <span class="h-1 w-3/4 rounded-full" :style="{ background: variation.colors.foreground }" />
        <span class="h-1 w-1/2 rounded-full" :style="{ background: variation.colors['muted-foreground'] }" />
        <span class="mt-auto flex gap-1">
          <span class="h-2.5 w-7" :style="{ background: variation.colors.primary, borderRadius: `${variation.radius / 4}px` }" />
          <span class="h-2.5 w-5" :style="{ background: variation.colors.secondary, borderRadius: `${variation.radius / 4}px` }" />
        </span>
      </span>
      <span class="absolute bottom-0.5 left-1/2 h-2.5 w-9 -translate-x-1/2 rounded-full" :style="{ background: variation.colors.toast }" />
    </span>
  </span>
  <span
    v-else
    class="flex h-10 w-16 flex-none overflow-hidden rounded-md border"
    :style="{ background: variation.colors.background, borderColor: variation.colors.border }"
    aria-hidden="true"
  >
    <span class="flex w-3.5 flex-none flex-col items-center pt-1.5" :style="{ background: variation.colors.rail }">
      <span class="size-2 rounded-[2px]" :style="{ background: variation.colors.primary }" />
    </span>
    <span class="m-1 flex flex-1 flex-col gap-1 rounded-[3px] p-1" :style="{ background: variation.colors.card }">
      <span class="h-0.5 w-3/4 rounded-full" :style="{ background: variation.colors.foreground }" />
      <span class="h-0.5 w-1/2 rounded-full" :style="{ background: variation.colors['muted-foreground'] }" />
      <span class="mt-auto h-1.5 w-5 rounded-[2px]" :style="{ background: variation.colors.primary }" />
    </span>
  </span>
</template>
