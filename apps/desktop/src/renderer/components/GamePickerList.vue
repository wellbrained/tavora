<script setup lang="ts">
// The games in the Add a game picker. With nothing typed: the covers of the games played lately, then the rest of this
// PC's games. Typed: one list, this PC's games first, then the built-in and online ones under More games, and the typed
// name as the user's own game last. Presentational: the owner keeps the rows, the highlight (a key) and what a pick
// does. A hover highlights, a click picks the item clicked; focus stays in the search, so Enter keeps working.
// Shared with the first-run welcome.
import { Loader } from "@lucide/vue";
import { computed } from "vue";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { cn } from "@tavora/official-ui/lib/utils";
import { t } from "../i18n";
import { CUSTOM_KEY, type PickerBadge, type PickerRow } from "../lib/game-picker";
import GameCover from "./GameCover.vue";
import GameTile from "./GameTile.vue";

const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    /** The covers above the list; empty for none. */
    covers?: readonly PickerRow[];
    rows: readonly PickerRow[];
    /** The highlighted item's key. */
    active: string | null;
    /** The extra last row that adds the typed name as the user's own game; null for none. */
    custom: string | null;
    /** Something was typed: the list is the search's, with its parts named. */
    typed: boolean;
    info: (row: PickerRow) => PickerBadge;
    coverOf?: (row: PickerRow) => string | null | undefined;
    /** The key of the item being added: it shows a spinner, the rest is dimmed and takes no clicks. */
    adding?: string | null;
    /** Start of each row's test id (`<prefix>-<game id>`); tests only. */
    testPrefix?: string;
    customTestid?: string;
  }>(),
  { covers: () => [], coverOf: () => null, adding: null, testPrefix: "catalog", customTestid: "add-custom" },
);
const emit = defineEmits<{ hover: [key: string]; pick: [key: string] }>();

/** Ids go by place, covers first: the search names the highlighted one with aria-activedescendant. */
const places = computed(() => new Map([...props.covers, ...props.rows].map((row, index) => [row.key, index])));
const customPlace = computed(() => props.covers.length + props.rows.length);

/** The parts of the list, each under its heading: this PC's games, then (typed) the rest under More games. */
const parts = computed(() => {
  if (!props.typed) return [{ key: "pc", heading: props.covers.length ? t("addGame.morePc") : t("addGame.onPc"), rows: props.rows }];
  return [
    { key: "pc", heading: t("addGame.onPc"), rows: props.rows.filter((row) => row.section === "pc") },
    { key: "more", heading: t("addGame.moreGames"), rows: props.rows.filter((row) => row.section !== "pc") },
  ];
});

/** Each row's badge and second line, worked out when the rows change rather than on every move of the highlight. */
const badges = computed(() => new Map([...props.covers, ...props.rows].map((row) => [row.key, props.info(row)])));
const modules = (row: PickerRow) => badges.value.get(row.key)?.modules ?? 0;
const second = (row: PickerRow) => (props.adding === row.key ? t("addGame.adding") : row.workspaceId ? t("addGame.added") : (badges.value.get(row.key)?.when ?? null));

/** What every option has: its id, its state for the search, and hover and click by its key. */
function option(key: string, place: number) {
  const dimmed = props.adding !== null && props.adding !== key;
  return {
    id: `${props.id}-option-${place}`,
    role: "option",
    "aria-selected": key === props.active,
    "aria-disabled": dimmed || undefined,
    class: cn("cursor-pointer transition-opacity", key === props.active && "bg-accent", dimmed && "opacity-50"),
    onMousemove: () => props.adding === null && key !== props.active && emit("hover", key),
    onClick: () => props.adding === null && emit("pick", key),
  };
}
</script>

<template>
  <!-- mousedown is kept from moving focus: the search keeps it, so the arrows and Enter still work after a click. -->
  <div :id="id" role="listbox" :aria-label="label" :aria-busy="adding !== null" :class="cn('flex flex-col gap-1', adding !== null && 'pointer-events-none')" @mousedown.prevent>
    <div v-if="covers.length" role="group" :aria-labelledby="`${id}-lately`" class="px-2 pb-2">
      <p :id="`${id}-lately`" class="text-muted-foreground px-1 pt-1 pb-2 text-xs font-medium">{{ t("addGame.lately") }}</p>
      <div class="grid grid-cols-4 gap-2">
        <div v-for="row in covers" :key="row.key" v-bind="option(row.key, places.get(row.key)!)" class="flex min-w-0 flex-col gap-1.5 rounded-xl p-1.5" :data-testid="`cover-${row.gameId ?? row.key}`">
          <GameCover :id="row.gameId ?? row.key" :name="row.name" :icon="row.icon" :cover="coverOf(row)" :busy="adding === row.key" />
          <span class="min-w-0 px-0.5">
            <span class="block truncate text-sm font-medium" :title="row.name">{{ row.name }}</span>
            <span class="text-muted-foreground block truncate text-xs">{{ second(row) }}</span>
          </span>
        </div>
      </div>
    </div>

    <template v-for="part in parts" :key="part.key">
      <div v-if="part.rows.length" role="group" :aria-labelledby="`${id}-${part.key}`" class="px-2">
        <p :id="`${id}-${part.key}`" class="text-muted-foreground px-3 pt-1 pb-1 text-xs font-medium">{{ part.heading }}</p>
        <div v-for="row in part.rows" :key="row.key" v-bind="option(row.key, places.get(row.key)!)" class="relative flex items-center gap-3 rounded-lg px-3 py-2" :data-testid="`${testPrefix}-${row.gameId ?? row.key}`">
          <span v-if="row.key === active" class="bg-primary absolute inset-y-1.5 left-0 w-0.5 rounded-full" aria-hidden="true" />
          <GameTile :id="row.gameId ?? row.key" :name="row.name" :icon="row.icon" :size="28" />
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2">
              <span class="truncate font-medium">{{ row.name }}</span>
              <span v-if="modules(row) > 0" class="bg-primary/15 text-primary flex-none rounded-full px-2 py-px text-xs" :data-testid="`module-badge-${row.gameId ?? row.key}`">{{
                modules(row) === 1 ? t("addGame.moduleOne") : t("addGame.moduleMany", { count: modules(row) })
              }}</span>
            </span>
            <span v-if="second(row)" class="text-muted-foreground block truncate text-xs">{{ second(row) }}</span>
          </span>
          <Loader v-if="adding === row.key" class="text-muted-foreground size-4 flex-none animate-spin motion-reduce:animate-none" :stroke-width="1.75" aria-hidden="true" />
          <span v-else-if="row.key === active" class="text-muted-foreground flex flex-none items-center gap-1.5 text-xs" aria-hidden="true" data-testid="row-action"
            >{{ row.workspaceId ? t("addGame.actionOpen") : t("addGame.actionAdd") }} <Kbd class="font-sans">↵</Kbd></span
          >
        </div>
      </div>
    </template>

    <div v-if="custom" v-bind="option(CUSTOM_KEY, customPlace)" class="relative mx-2 flex items-center gap-3 rounded-lg px-3 py-2" :data-testid="customTestid">
      <span v-if="active === CUSTOM_KEY" class="bg-primary absolute inset-y-1.5 left-0 w-0.5 rounded-full" aria-hidden="true" />
      <GameTile :id="custom" :name="custom" :size="28" />
      <span class="min-w-0 flex-1">
        <span class="text-primary block truncate">{{ t("addGame.custom", { name: custom }) }}</span>
        <span v-if="adding === CUSTOM_KEY" class="text-muted-foreground block truncate text-xs">{{ t("addGame.adding") }}</span>
      </span>
      <Loader v-if="adding === CUSTOM_KEY" class="text-muted-foreground size-4 flex-none animate-spin motion-reduce:animate-none" :stroke-width="1.75" aria-hidden="true" />
      <span v-else-if="active === CUSTOM_KEY" class="text-muted-foreground flex flex-none items-center gap-1.5 text-xs" aria-hidden="true" data-testid="row-action"
        >{{ t("addGame.actionAdd") }} <Kbd class="font-sans">↵</Kbd></span
      >
    </div>
  </div>
</template>
