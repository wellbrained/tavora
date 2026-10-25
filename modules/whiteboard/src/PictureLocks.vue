<script setup lang="ts">
// A lock on the corner of every picture (placed by locks.ts), over the board. It sits below Excalidraw's menus and
// above its drawing; a locked picture cannot be clicked in Excalidraw at all, so its lock is the way to free it again.
import { Lock, LockOpen } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { cn } from "@tavora/official-ui";
import { t } from "./i18n";
import type { LockSpot } from "./locks";

defineProps<{ spots: readonly LockSpot[] }>();
const emit = defineEmits<{ toggle: [id: string, locked: boolean] }>();
</script>

<template>
  <div v-if="spots.length > 0" class="picture-locks pointer-events-none absolute inset-0 z-[2] overflow-hidden">
    <Button
      v-for="spot in spots"
      :key="spot.id"
      type="button"
      variant="ghost"
      size="icon-xs"
      :class="
        cn(
          'pointer-events-auto absolute size-6 -translate-x-1/2 -translate-y-1/2 bg-black/45 text-white opacity-55 transition-opacity hover:bg-black/60 hover:text-white hover:opacity-100 focus-visible:opacity-100',
          spot.locked && 'bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground opacity-100',
        )
      "
      :style="{ left: `${spot.x}px`, top: `${spot.y}px` }"
      :data-locked="spot.locked"
      data-testid="picture-lock-one"
      :aria-label="t(spot.locked ? 'image.unlockOne' : 'image.lockOne')"
      :title="t(spot.locked ? 'image.unlockOne' : 'image.lockOne')"
      @pointerdown.stop
      @click="emit('toggle', spot.id, !spot.locked)"
    >
      <component :is="spot.locked ? Lock : LockOpen" :stroke-width="2" />
    </Button>
  </div>
</template>
