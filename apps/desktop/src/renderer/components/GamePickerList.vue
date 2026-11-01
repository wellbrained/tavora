<script setup lang="ts">
// The list of games in the Add a game picker: icon, name, a badge when modules exist for it, and when it was
// played or installed. Presentational: the dialog owns the rows, the highlighted row and what a pick does.
// Built to be reused, e.g. by the first-run welcome.
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import type { PickerRow } from "../lib/game-picker";
import GameTile from "./GameTile.vue";

export interface PickerBadge {
  /** How many modules the catalog has for the game. */
  modules: number;
  /** The second line, already in words. */
  when: string | null;
}

const props = defineProps<{
  id: string;
  label: string;
  rows: readonly PickerRow[];
  active: number;
  /** The extra last row that adds the typed name as the user's own game; null for none. */
  custom: string | null;
  info: (row: PickerRow) => PickerBadge;
  busy?: boolean;
}>();
const emit = defineEmits<{ hover: [index: number]; pick: [index: number] }>();

const optionId = (index: number) => `${props.id}-option-${index}`;
</script>

<template>
  <ul :id="id" role="listbox" :aria-label="label" class="m-0 list-none p-0">
    <li
      v-for="(row, index) in rows"
      :id="optionId(index)"
      :key="row.key"
      role="option"
      :aria-selected="index === active"
      :class="cn('group relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2', index === active && 'bg-accent', row.workspaceId && 'opacity-60')"
      :data-testid="`catalog-${row.gameId ?? row.key}`"
      @mousemove="emit('hover', index)"
      @click="!busy && emit('pick', index)"
    >
      <span v-if="index === active" class="bg-primary absolute inset-y-1.5 left-0 w-0.5 rounded-full" aria-hidden="true" />
      <GameTile :id="row.gameId ?? row.key" :name="row.name" :icon="row.icon" :size="28" />
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2">
          <span class="truncate font-medium">{{ row.name }}</span>
          <span
            v-if="info(row).modules > 0"
            class="bg-primary/15 text-primary flex-none rounded-full px-2 py-px text-xs"
            :data-testid="`module-badge-${row.gameId ?? row.key}`"
            >{{ info(row).modules === 1 ? t("addGame.moduleOne") : t("addGame.moduleMany", { count: info(row).modules }) }}</span
          >
        </span>
        <span class="text-muted-foreground block truncate text-xs">{{ row.workspaceId ? t("addGame.added") : info(row).when }}</span>
      </span>
      <Kbd v-if="index === active" class="font-sans" aria-hidden="true">{{ t("search.key.enter") }}</Kbd>
    </li>
    <li
      v-if="custom"
      :id="optionId(rows.length)"
      role="option"
      :aria-selected="active === rows.length"
      :class="cn('relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2', active === rows.length && 'bg-accent')"
      data-testid="add-custom"
      @mousemove="emit('hover', rows.length)"
      @click="!busy && emit('pick', rows.length)"
    >
      <span v-if="active === rows.length" class="bg-primary absolute inset-y-1.5 left-0 w-0.5 rounded-full" aria-hidden="true" />
      <GameTile :id="custom" :name="custom" :size="28" />
      <span class="text-primary min-w-0 flex-1 truncate">{{ t("addGame.custom", { name: custom }) }}</span>
      <Kbd v-if="active === rows.length" class="font-sans" aria-hidden="true">{{ t("search.key.enter") }}</Kbd>
    </li>
  </ul>
</template>
