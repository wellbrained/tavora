<script setup lang="ts">
import type { GameView } from "../../shared/host-api";
import { cn } from "@/lib/utils";
import type { MenuItem } from "@/host";
import GameIcon from "./GameIcon.vue";
import MenuArea from "./menus/MenuArea.vue";
import MenuButton from "./menus/MenuButton.vue";

defineProps<{
  game: GameView;
  testid: string;
  active: boolean;
  expanded: boolean;
  menu: () => MenuItem[];
  /** Where a dragged item would land relative to this one. */
  hint?: "before" | "after" | "into" | null;
}>();
const emit = defineEmits<{ open: [] }>();
// Drag handlers from the rail go on the row, not on the menu wrapper.
defineOptions({ inheritAttrs: false });
</script>

<template>
  <MenuArea :items="menu" :title="game.name">
    <div
      :class="cn('group relative flex items-center px-2', hint && `drop-${hint}`)"
      draggable="true"
      v-bind="$attrs"
    >
      <span v-if="active" class="bg-primary absolute inset-y-3 left-0 w-[3px] rounded-r-sm" aria-hidden="true" />
      <button
        type="button"
        :class="
          cn(
            'hover:bg-accent flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left',
            active && 'bg-accent',
            hint === 'into' && 'ring-primary ring-2 ring-inset',
          )
        "
        data-rail-item
        :data-testid="testid"
        :aria-current="active ? 'page' : undefined"
        :aria-label="game.name"
        :title="expanded ? undefined : game.name"
        @click="emit('open')"
      >
        <GameIcon :game="game" :size="48" />
        <span v-if="expanded" class="truncate text-sm font-medium">{{ game.name }}</span>
      </button>
      <div
        v-if="expanded"
        class="bg-accent absolute right-4 opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
      >
        <MenuButton :items="menu" :title="game.name" :testid="`${testid}-menu`" :label="`More actions for ${game.name}`" />
      </div>
    </div>
  </MenuArea>
</template>
