<script setup lang="ts">
import { cn } from "@tavora/official-ui/lib/utils";

// The tile every item at the bottom of the rail sits on: one size, one shape, and a status dot
// in the same corner. The 48 px slot keeps it on the same centre line as the workspace tiles.
// In the expanded rail it is only the icon, in a 30 px slot like the workspace icons; the row shows hover and state.
// `progress` (0 to 100) draws a ring along the tile's edge that fills clockwise, as the update marker does while it downloads.
defineProps<{ dot?: "success" | "primary"; progress?: number }>();
// Classes from the outside go on the tile itself, not on the slot around it.
defineOptions({ inheritAttrs: false });
</script>

<template>
  <span class="footer-slot relative flex w-12 flex-none justify-center">
    <!-- Lights up while the rail item around it is hovered, also when the rail is collapsed. -->
    <span
      class="footer-tile bg-card relative grid size-10 place-items-center overflow-hidden rounded-[10px] transition-[background-color,box-shadow] duration-150 [[data-rail-item]:hover_&]:bg-[color-mix(in_srgb,var(--foreground)_12%,var(--card))] [[data-rail-item]:hover_&]:shadow-[0_0_12px_0_color-mix(in_oklab,var(--primary)_30%,transparent)]"
      v-bind="$attrs"
    >
      <slot />
      <svg v-if="progress !== undefined" class="pointer-events-none absolute inset-0 size-full" viewBox="0 0 40 40" aria-hidden="true" data-testid="rail-tile-progress">
        <rect x="1.25" y="1.25" width="37.5" height="37.5" rx="8.75" fill="none" stroke-width="2.5" class="stroke-[color-mix(in_oklab,var(--primary)_22%,transparent)]" />
        <rect
          x="1.25"
          y="1.25"
          width="37.5"
          height="37.5"
          rx="8.75"
          fill="none"
          stroke-width="2.5"
          stroke-linecap="round"
          pathLength="100"
          :stroke-dasharray="`${Math.min(100, Math.max(0, progress))} 100`"
          class="stroke-primary"
        />
      </svg>
    </span>
    <span
      v-if="dot"
      :class="cn('ring-rail absolute top-0 right-0.5 size-3 rounded-full ring-[3px]', dot === 'success' ? 'bg-success' : 'bg-primary')"
      aria-hidden="true"
    />
  </span>
</template>
