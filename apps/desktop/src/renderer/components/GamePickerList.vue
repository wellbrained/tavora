<script setup lang="ts">
// The games in the Add a game picker. With nothing typed: the covers of the games played lately, then the rest of this
// PC's games. Typed: one list, this PC's games first, then the built-in and online ones under More games, and the typed
// name as the user's own game under Not on the list. Rows are the kit's palette rows (PaletteItem); the covers are
// tiles of their own look in a grid, still options of the same list. Presentational: the owner keeps the lines (in
// the order to show them), the highlight (a key) and what a pick does. A hover highlights, a click picks the item
// clicked; focus stays in the search, so Enter keeps working. Shared with the first-run welcome.
import { computed, watch } from "vue";
import { GameCover } from "@tavora/official-ui/components/ui/game-cover";
import { PaletteGroup, PaletteItem, PaletteList } from "@tavora/official-ui/components/ui/palette";
import { cn } from "@tavora/official-ui/lib/utils";
import { badgeLook } from "../badge";
import { t } from "../i18n";
import { optionId, type PickerBadge, type PickerLine, type PickerRow } from "../lib/game-picker";
import GameTile from "./GameTile.vue";

const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    /** The covers above the list; empty for none. */
    covers?: readonly PickerRow[];
    /** The list, in the order to show it; a line without a row is the typed name as the user's own game. */
    lines: readonly PickerLine[];
    /** The highlighted item's key. */
    active: string | null;
    /** The typed name, for the line that adds it as the user's own game. */
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

type Part = "pc" | "more" | "custom";
/**
 * The list in runs of one part each, the first line of a run under its heading: this PC's games, then (typed) the rest
 * under More games. A line keeps its place, so a part that comes in late has a run (and its heading) of its own below.
 */
const runs = computed(() => {
  const partOf = (line: PickerLine): Part => (!line.row ? "custom" : props.typed && line.row.section !== "pc" ? "more" : "pc");
  const heading = (part: Part) => (part === "custom" ? t("addGame.notListed") : part === "more" ? t("addGame.moreGames") : props.typed || !props.covers.length ? t("addGame.onPc") : t("addGame.morePc"));
  const result: { key: string; heading: string; lines: PickerLine[] }[] = [];
  let last: Part | null = null;
  for (const line of props.lines) {
    const part = partOf(line);
    if (part !== last) result.push({ key: `${part}-${result.length}`, heading: heading(part), lines: [] });
    result.at(-1)!.lines.push(line);
    last = part;
  }
  return result;
});

/** Each row's badge and second line, worked out when the rows change rather than on every move of the highlight. */
const badges = computed(() => new Map([...props.covers, ...props.lines.flatMap((line) => line.row ?? [])].map((row) => [row.key, props.info(row)])));
const modules = (row: PickerRow) => badges.value.get(row.key)?.modules ?? 0;
const second = (row: PickerRow) => (props.adding === row.key ? t("addGame.adding") : row.workspaceId ? t("addGame.added") : (badges.value.get(row.key)?.when ?? null));
/** A line's second line: its game's (see second), or for the typed name what picking it does. */
const secondOf = (line: PickerLine) => (line.row ? second(line.row) : props.adding === line.key ? t("addGame.adding") : t("addGame.customHint"));
const modulesText = (count: number) => (count === 1 ? t("addGame.moduleOne") : t("addGame.moduleMany", { count }));

/** A cover without art: the game's tile on its colour, as the rail draws it. */
function toneOf(row: PickerRow) {
  const look = badgeLook(row.gameId ?? row.key);
  return { backgroundColor: look.color, backgroundImage: look.image, backgroundSize: look.size };
}

// ── Pointer ────────────────────────────────────────────────────────────
// A click picks what the user saw under the pointer. When the items changed since the pointer last moved and another
// item slid in under it, that may not be what they aimed at: that first click only highlights it, and the next one picks.

/** The items changed since the pointer last moved. */
let moved = false;
watch(
  () => [...props.covers.map((row) => row.key), "", ...props.lines.map((line) => line.key)].join("\n"),
  () => (moved = true),
);
/** Where the pointer was at its last move: a move event at the same place is the list moving under a still pointer. */
let at: { x: number; y: number } | null = null;
/** The item the pointer last moved over (null: off the items). */
let aimed: string | null = null;

function onMove(key: string | null, event: MouseEvent) {
  if (at?.x === event.screenX && at.y === event.screenY) return;
  at = { x: event.screenX, y: event.screenY };
  moved = false;
  aimed = key;
  if (key !== null && props.adding === null && key !== props.active) emit("hover", key);
}

/** A move over the list but off its items. */
function onListMove(event: MouseEvent) {
  if (!(event.target instanceof Element && event.target.closest('[role="option"]'))) onMove(null, event);
}

function onClick(key: string, event: MouseEvent) {
  if (props.adding !== null) return;
  // Held back only for an item that came under a still pointer. A click from the keyboard or a screen reader (detail 0)
  // has no pointer to have missed, and one on the highlight (where a screen reader routes its click) is aimed.
  if (moved && event.detail > 0 && key !== aimed && key !== props.active) {
    moved = false;
    aimed = key;
    emit("hover", key);
    return;
  }
  emit("pick", key);
}

/** Dimmed while another item is added. */
const dimmed = (key: string) => props.adding !== null && props.adding !== key;

/** What every option has: its id, and hover and click by its key. */
function handlers(key: string) {
  return {
    id: optionId(props.id, key),
    onMousemove: (event: MouseEvent) => onMove(key, event),
    // A touch or a pen has no moves before its tap: the tap is aimed.
    onPointerdown: (event: PointerEvent) => event.pointerType !== "mouse" && (moved = false),
    onClick: (event: MouseEvent) => onClick(key, event),
  };
}

/** A cover tile is an option of its own look (a picture, not a row). */
function cover(key: string) {
  return {
    ...handlers(key),
    role: "option",
    "aria-selected": key === props.active,
    "aria-disabled": dimmed(key) || undefined,
    class: cn("cursor-pointer", key === props.active && "bg-accent", dimmed(key) && "opacity-(--disabled-opacity)"),
  };
}
</script>

<template>
  <!-- The list keeps the focus in the search (PaletteList), so the arrows and Enter still work after a click. -->
  <PaletteList :id="id" :label="label" :busy="adding !== null" :class="cn('gap-1 py-0', adding !== null && 'pointer-events-none')" @mousemove="onListMove">
    <PaletteGroup v-if="covers.length" :label="t('addGame.lately')" class="pb-2">
      <div class="grid grid-cols-6 gap-1">
        <div v-for="row in covers" :key="row.key" v-bind="cover(row.key)" class="flex min-w-0 flex-col gap-1.5 rounded-lg p-2" :data-testid="`cover-${row.gameId ?? row.key}`">
          <GameCover :src="coverOf(row) ?? null" :loading="coverOf(row) === undefined" :busy="adding === row.key">
            <template #fallback>
              <span class="grid size-full place-items-center" :style="toneOf(row)">
                <GameTile :id="row.gameId ?? row.key" :name="row.name" :icon="row.icon" :size="56" />
              </span>
            </template>
          </GameCover>
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium" :title="row.name">{{ row.name }}</span>
            <span class="text-muted-foreground block truncate text-xs">{{ second(row) }}</span>
          </span>
        </div>
      </div>
    </PaletteGroup>

    <PaletteGroup v-for="run in runs" :key="run.key" :label="run.heading">
      <PaletteItem
        v-for="line in run.lines"
        :key="line.key"
        v-bind="handlers(line.key)"
        :active="line.key === active"
        :busy="adding === line.key"
        :disabled="dimmed(line.key)"
        :data-testid="line.row ? `${testPrefix}-${line.row.gameId ?? line.key}` : customTestid"
      >
        <template #leading>
          <GameTile :id="line.row ? (line.row.gameId ?? line.key) : (custom ?? '')" :name="line.row?.name ?? custom ?? ''" :icon="line.row?.icon ?? null" :size="28" />
        </template>
        {{ line.row?.name ?? custom ?? "" }}
        <template v-if="secondOf(line)" #description>{{ secondOf(line) }}</template>
        <template v-if="line.row && modules(line.row) > 0" #trailing>
          <span :data-testid="`module-badge-${line.row.gameId ?? line.key}`">{{ modulesText(modules(line.row)) }}</span>
        </template>
      </PaletteItem>
    </PaletteGroup>
  </PaletteList>
</template>
