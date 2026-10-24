<script setup lang="ts">
import { cn } from "@/lib/utils";

// The tile every item at the bottom of the rail sits on: one size, one shape, and a status dot
// in the same corner. The 48 px slot keeps it on the same centre line as the game tiles.
defineProps<{ dot?: "success" | "primary" }>();
// Classes from the outside go on the tile itself, not on the slot around it.
defineOptions({ inheritAttrs: false });
</script>

<template>
  <span class="relative flex w-12 flex-none justify-center">
    <!-- Lights up while the rail item around it is hovered, also when the rail is collapsed. -->
    <span
      class="bg-card relative grid size-10 place-items-center overflow-hidden rounded-[10px] transition-[background-color,box-shadow] duration-150 [[data-rail-item]:hover_&]:bg-[color-mix(in_srgb,var(--foreground)_12%,var(--card))] [[data-rail-item]:hover_&]:shadow-[0_0_12px_0_color-mix(in_oklab,var(--primary)_30%,transparent)]"
      v-bind="$attrs"
    >
      <slot />
    </span>
    <span
      v-if="dot"
      :class="cn('ring-rail absolute top-0 right-0.5 size-3 rounded-full ring-[3px]', dot === 'success' ? 'bg-success' : 'bg-primary')"
      aria-hidden="true"
    />
  </span>
</template>
