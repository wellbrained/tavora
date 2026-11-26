<script setup lang="ts">
// A lock on the corner of every picture (placed by locks.ts), over the board. It sits below Excalidraw's menus and
// above its drawing; a locked picture cannot be clicked in Excalidraw at all, so its lock is the way to free it again.
import { Lock, LockOpen } from "@lucide/vue";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { cn } from "@tavora/official-ui";
import { LOCKS_CLASS } from "./excalidrawDom";
import { t } from "./i18n";
import type { LockSpot } from "./locks";

defineProps<{ spots: readonly LockSpot[]; activeId: string | null }>();
const emit = defineEmits<{ toggle: [id: string, locked: boolean] }>();
</script>

<template>
  <div v-if="spots.length > 0" :class="LOCKS_CLASS" class="pointer-events-none absolute inset-0 z-[2] overflow-hidden">
    <!-- A dark chip over the picture, the same whether locked or not (the icon says which); the toggle says it to screen readers. -->
    <Toggle
      v-for="spot in spots"
      :key="spot.id"
      variant="ghost"
      size="sm"
      :model-value="spot.locked"
      :label="t('image.lockOne')"
      :class="
        cn(
          'picture-lock pointer-events-auto absolute size-6 min-w-0 -translate-x-1/2 -translate-y-1/2 bg-black/65 text-white opacity-0 transition-opacity hover:bg-black/80 hover:text-white hover:opacity-100 focus-visible:opacity-100 data-[state=on]:bg-black/65 data-[state=on]:text-white data-[state=on]:hover:bg-black/80 data-[state=on]:hover:text-white [&_svg:not([class*=size-])]:size-3.5',
          (spot.id === activeId || spot.selected) && 'opacity-100',
        )
      "
      :style="{ left: `${spot.x}px`, top: `${spot.y}px` }"
      :data-locked="spot.locked"
      data-testid="picture-lock-one"
      @pointerdown.stop
      @update:model-value="emit('toggle', spot.id, $event)"
    >
      <component :is="spot.locked ? Lock : LockOpen" />
    </Toggle>
  </div>
</template>
