<script setup lang="ts">
// A folder in the rail: a folder shape (with its tab), so it cannot be taken for a game, with up to four of its
// games inside. The four places stay put and fill from the top left to the bottom right, so one game sits in
// the first place and the rest stay empty. An open folder has an
// outlined shape in the accent colour.
import { computed } from "vue";
import type { GameView } from "../../shared/host-api";
import { cn } from "@/lib/utils";
import GameIcon from "./GameIcon.vue";

const props = defineProps<{
  /** The folder's games in order; only the first four are drawn. */
  games: GameView[];
  /** Letters the user chose for the folder, shown instead of its games. */
  label: string | null;
  open: boolean;
}>();

const SLOTS = [0, 1, 2, 3];
const shown = computed(() => props.games.slice(0, 4));
</script>

<template>
  <span class="rail-icon relative block size-12 flex-none" aria-hidden="true" data-testid="folder-tile">
    <svg viewBox="0 0 48 48" class="absolute inset-0 size-full overflow-visible">
      <path
        d="M1 5.5Q1 1 5 1H16Q18.5 1 19.8 3.1L21.2 5.5H43Q47 5.5 47 9.5V43Q47 47 43 47H5Q1 47 1 43Z"
        :class="cn('fill-card stroke-1', open ? 'stroke-primary' : 'stroke-border')"
        stroke-linejoin="round"
      />
    </svg>
    <span v-if="label" class="absolute inset-x-1 top-2 bottom-1 flex items-center justify-center text-sm font-semibold">{{ label }}</span>
    <span v-else class="absolute top-2 left-[5.5px] grid grid-cols-[17px_17px] grid-rows-[17px_17px] gap-[3px]">
      <template v-for="slot in SLOTS" :key="slot">
        <GameIcon v-if="shown[slot]" :game="shown[slot]!" :size="17" />
        <span v-else class="bg-foreground/[0.07] size-[17px] rounded-[4px]" data-testid="folder-empty-slot" />
      </template>
    </span>
  </span>
</template>
