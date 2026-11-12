<script setup lang="ts">
// The games in the Add a game picker. With nothing typed: the covers of the games played lately, then the rest of this
// PC's games. Typed: one list, this PC's games first, then the built-in and online ones under More games, and the typed
// name as the user's own game. Presentational: the owner keeps the lines (in the order to show them), the highlight (a
// key) and what a pick does. A hover highlights, a click picks the item clicked; focus stays in the search, so Enter
// keeps working. Shared with the first-run welcome.
import { Loader } from "@lucide/vue";
import { computed, watch } from "vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { GameCover } from "@tavora/official-ui/components/ui/game-cover";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
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
  const heading = (part: Part) => (part === "custom" ? null : part === "more" ? t("addGame.moreGames") : props.typed || !props.covers.length ? t("addGame.onPc") : t("addGame.morePc"));
  const result: { key: string; heading: string | null; lines: PickerLine[] }[] = [];
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
/** A line's second line: its game's (see second), or for the typed name only while it is added. */
const secondOf = (line: PickerLine) => (line.row ? second(line.row) : props.adding === line.key ? t("addGame.adding") : null);

/** A cover without art: the game's tile on its colour, as the rail draws it. */
function toneOf(row: PickerRow) {
  const look = badgeLook(row.gameId ?? row.key);
  return { backgroundColor: look.color, backgroundImage: look.image, backgroundSize: look.size };
}

// ── Pointer ────────────────────────────────────────────────────────────
// A click picks what the user saw under the pointer. When the items changed since the pointer last moved, what is
// under it now may not be what they aimed at: that first click only highlights it, and the next one picks.

/** The items changed since the pointer last moved. */
let moved = false;
watch(
  () => [...props.covers.map((row) => row.key), "", ...props.lines.map((line) => line.key)].join("\n"),
  () => (moved = true),
);
/** Where the pointer was at its last move: a move event at the same place is the list moving under a still pointer. */
let at: { x: number; y: number } | null = null;

function onMove(key: string, event: MouseEvent) {
  if (at?.x === event.screenX && at.y === event.screenY) return;
  at = { x: event.screenX, y: event.screenY };
  moved = false;
  if (props.adding === null && key !== props.active) emit("hover", key);
}

function onClick(key: string, event: MouseEvent) {
  if (props.adding !== null) return;
  // A click from the keyboard or a screen reader (detail 0) has no pointer to have missed.
  if (moved && event.detail > 0) {
    moved = false;
    emit("hover", key);
    return;
  }
  emit("pick", key);
}

/** What every option has: its id, its state for the search, and hover and click by its key. */
function option(key: string) {
  const dimmed = props.adding !== null && props.adding !== key;
  return {
    id: optionId(props.id, key),
    role: "option",
    "aria-selected": key === props.active,
    "aria-disabled": dimmed || undefined,
    class: cn("cursor-pointer", key === props.active && "bg-accent", dimmed && "opacity-50"),
    onMousemove: (event: MouseEvent) => onMove(key, event),
    // A touch or a pen has no moves before its tap: the tap is aimed.
    onPointerdown: (event: PointerEvent) => event.pointerType !== "mouse" && (moved = false),
    onClick: (event: MouseEvent) => onClick(key, event),
  };
}
</script>

<template>
  <!-- mousedown is kept from moving focus: the search keeps it, so the arrows and Enter still work after a click. -->
  <div :id="id" role="listbox" :aria-label="label" :aria-busy="adding !== null" :class="cn('flex flex-col gap-1', adding !== null && 'pointer-events-none')" @mousedown.prevent>
    <div v-if="covers.length" role="group" :aria-labelledby="`${id}-lately`" class="px-2 pb-2">
      <p :id="`${id}-lately`" class="text-muted-foreground px-2 pt-1 pb-1 text-xs font-medium">{{ t("addGame.lately") }}</p>
      <div class="grid grid-cols-4 gap-1">
        <div v-for="row in covers" :key="row.key" v-bind="option(row.key)" class="flex min-w-0 flex-col gap-1.5 rounded-lg p-2" :data-testid="`cover-${row.gameId ?? row.key}`">
          <GameCover :src="coverOf(row) ?? null" :pending="coverOf(row) === undefined" :busy="adding === row.key">
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
    </div>

    <template v-for="run in runs" :key="run.key">
      <div :role="run.heading ? 'group' : undefined" :aria-labelledby="run.heading ? `${id}-${run.key}` : undefined" class="px-2">
        <p v-if="run.heading" :id="`${id}-${run.key}`" class="text-muted-foreground px-3 pt-1 pb-1 text-xs font-medium">{{ run.heading }}</p>
        <div
          v-for="line in run.lines"
          :key="line.key"
          v-bind="option(line.key)"
          class="relative flex items-center gap-3 rounded-lg px-3 py-2"
          :data-testid="line.row ? `${testPrefix}-${line.row.gameId ?? line.key}` : customTestid"
        >
          <span v-if="line.key === active" class="bg-primary absolute inset-y-1.5 left-0 w-0.5 rounded-full" aria-hidden="true" />
          <GameTile :id="line.row ? (line.row.gameId ?? line.key) : (custom ?? '')" :name="line.row?.name ?? custom ?? ''" :icon="line.row?.icon ?? null" :size="28" />
          <span class="min-w-0 flex-1">
            <span v-if="line.row" class="flex items-center gap-2">
              <span class="truncate font-medium">{{ line.row.name }}</span>
              <Badge v-if="modules(line.row) > 0" variant="secondary" :data-testid="`module-badge-${line.row.gameId ?? line.key}`">{{
                modules(line.row) === 1 ? t("addGame.moduleOne") : t("addGame.moduleMany", { count: modules(line.row) })
              }}</Badge>
            </span>
            <span v-else class="text-primary block truncate">{{ t("addGame.custom", { name: custom ?? "" }) }}</span>
            <span v-if="secondOf(line)" class="text-muted-foreground block truncate text-xs">{{ secondOf(line) }}</span>
          </span>
          <Loader v-if="adding === line.key" class="text-muted-foreground size-4 flex-none animate-spin motion-reduce:animate-none" :stroke-width="1.75" aria-hidden="true" />
          <span v-else-if="line.key === active" class="text-muted-foreground flex flex-none items-center gap-1.5 text-xs" aria-hidden="true" data-testid="row-action"
            >{{ line.row?.workspaceId ? t("addGame.actionOpen") : t("addGame.actionAdd") }} <Kbd class="font-sans">↵</Kbd></span
          >
        </div>
      </div>
    </template>
  </div>
</template>
