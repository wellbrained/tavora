<script setup lang="ts">
import type { GameView } from "../../shared/host-api";
import { cn } from "@/lib/utils";
import type { MenuItem } from "@/host";
import { t } from "../i18n";
import GameIcon from "./GameIcon.vue";
import MenuArea from "./menus/MenuArea.vue";
import MenuButton from "./menus/MenuButton.vue";
import RailTooltip from "./RailTooltip.vue";

defineProps<{
  game: GameView;
  testid: string;
  active: boolean;
  expanded: boolean;
  menu: () => MenuItem[];
  /** Where a dragged item would land relative to this one. */
  hint?: "before" | "after" | "into" | null;
  /** A game inside an open folder: a little smaller. */
  compact?: boolean;
  /** The number Ctrl+1 to 9 opens it with, shown while Ctrl is held. */
  shortcut?: number | undefined;
}>();
const emit = defineEmits<{ open: [] }>();
// Drag handlers from the rail go on the row, not on the menu wrapper.
defineOptions({ inheritAttrs: false });
</script>

<template>
  <MenuArea :items="menu" :title="game.name">
    <div
      :class="cn('group rail-entry relative flex items-center px-2', hint && `drop-${hint}`)"
      :data-active="active"
      draggable="true"
      v-bind="$attrs"
    >
      <span class="rail-pill" aria-hidden="true" />
      <RailTooltip :text="game.name" :disabled="expanded">
      <button
        type="button"
        :class="
          cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left',
            compact ? 'p-0.5' : 'p-1',
            expanded && 'hover:bg-accent',
            expanded && active && 'bg-accent',
            hint === 'into' && 'ring-primary ring-2 ring-inset',
          )
        "
        data-rail-item
        :data-testid="testid"
        :aria-current="active ? 'page' : undefined"
        :aria-label="game.name"
        @click="emit('open')"
      >
        <span :class="cn('rail-icon flex-none', compact ? 'rounded-[10px]' : 'rounded-[12px]')"><GameIcon :game="game" :size="compact ? 40 : 48" /></span>
        <span v-if="expanded" class="truncate text-sm font-medium">{{ game.name }}</span>
        <kbd
          v-if="shortcut"
          class="bg-secondary text-primary ml-auto flex-none rounded-sm border border-b-2 px-1.5 py-0.5 font-mono text-xs"
          :data-testid="`${testid}-shortcut`"
          >{{ shortcut }}</kbd
        >
      </button>
      </RailTooltip>
      <div
        v-if="expanded"
        class="bg-accent absolute right-4 opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
      >
        <MenuButton :items="menu" :title="game.name" :testid="`${testid}-menu`" :label="t('rail.moreGame', { name: game.name })" />
      </div>
    </div>
  </MenuArea>
</template>
