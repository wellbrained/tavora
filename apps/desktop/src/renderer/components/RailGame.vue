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
      <RailTooltip :text="game.running ? t('rail.running', { name: game.name }) : game.name" :disabled="expanded">
      <button
        type="button"
        :class="
          cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left',
            expanded && 'hover:bg-accent',
            expanded && active && 'bg-accent',
            hint === 'into' && 'ring-primary ring-2 ring-inset',
          )
        "
        data-rail-item
        :data-testid="testid"
        :aria-current="active ? 'page' : undefined"
        :aria-label="game.running ? t('rail.running', { name: game.name }) : game.name"
        @click="emit('open')"
      >
        <span class="relative flex-none">
          <span class="rail-icon flex rounded-[12px]"><GameIcon :game="game" :size="48" /></span>
          <!-- The game is running on this PC (Settings > General, "When a game starts"). -->
          <span v-if="game.running" class="bg-success ring-rail absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-[3px]" :data-testid="`${testid}-running`" />
        </span>
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
