<script setup lang="ts">
// The drop guide: while a panel is dragged over a group, a cross of five
// cells at its centre shows where it can go (beside the group on any side,
// or into it as a tab) and lights the one the drop will use. Aiming at a
// cell picks it; the highlighted area shows the result.
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Layers } from "@lucide/vue";
import type { Component } from "vue";
import type { Position } from "dockview-vue";
import { cn } from "@/lib/utils";
import { GUIDE, GUIDE_CELLS } from "../../dock";

export interface GuideState {
  /** The group's content area, relative to the dock's container. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where the drop goes now. */
  position: Position;
  /** Which cells would take the drop. */
  allowed: Record<Position, boolean>;
}

defineProps<{ guide: GuideState }>();

const ICONS: Record<Position, Component> = { top: ArrowUp, left: ArrowLeft, center: Layers, right: ArrowRight, bottom: ArrowDown };
const step = GUIDE.cell + GUIDE.gap;
</script>

<template>
  <div
    class="pointer-events-none absolute z-[45]"
    :style="{ left: `${guide.x}px`, top: `${guide.y}px`, width: `${guide.width}px`, height: `${guide.height}px` }"
    data-testid="drop-guide"
    :data-position="guide.position"
    aria-hidden="true"
  >
    <div
      v-for="cell in GUIDE_CELLS"
      :key="cell.position"
      :class="
        cn(
          'bg-card/95 text-muted-foreground absolute flex items-center justify-center rounded-lg border shadow-sm',
          guide.position === cell.position && guide.allowed[cell.position] && 'bg-primary text-primary-foreground border-primary',
          !guide.allowed[cell.position] && 'opacity-35',
        )
      "
      :style="{
        width: `${GUIDE.cell}px`,
        height: `${GUIDE.cell}px`,
        left: `calc(50% + ${cell.dx * step - GUIDE.cell / 2}px)`,
        top: `calc(50% + ${cell.dy * step - GUIDE.cell / 2}px)`,
      }"
      :data-testid="`drop-guide-${cell.position}`"
    >
      <component :is="ICONS[cell.position]" class="size-5" :stroke-width="1.75" />
    </div>
  </div>
</template>
