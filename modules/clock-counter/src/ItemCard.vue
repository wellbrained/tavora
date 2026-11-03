<script setup lang="ts">
// One clock or counter as a single compact row: its name, the time or number, the buttons to run it, and a ··· button
// whose menu has the rest (Settings, which opens in a dialog over the workspace and is this panel's own; Move up, Move down, Delete).
// On a very narrow panel the row wraps to two lines.
import { ArrowDown, ArrowUp, Ellipsis, Flag, Hash, Hourglass, Minus, Pause, Play, Plus, RotateCcw, Settings, Timer, Trash2 } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { CountTo } from "@tavora/official-ui/components/ui/count-to";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { computed, inject, ref } from "vue";
import { t } from "./i18n";
import { canMove, goalReached, lapSplits, readClock, sourcesOf, type Item } from "./items";
import { PANEL } from "./panel";
import { formatSeconds } from "./time";

// One ··· button ends the row; it opens the row's menu. A right-click (or Shift+F10) opens the same menu, which the kit
// places next to the button at the row's end, never at the pointer.
const props = defineProps<{ item: Item }>();
const emit = defineEmits<{ toggleEdit: [] }>();
const panel = inject(PANEL)!;

const menuOpen = ref(false);

function onContextMenu(event: MouseEvent): void {
  // Inside a field or a link the usual menu stays; nothing here has one, but a future one should keep its copy and paste.
  if ((event.target as Element | null)?.closest?.("input, textarea, [contenteditable=true]")) return;
  event.preventDefault();
  menuOpen.value = true;
}

/** Del deletes the row at once, as in the menu (Undo is in the toast), but only from the row itself or its ··· button: on Start or + it is not meant for the row. */
function onKey(event: KeyboardEvent): void {
  if (event.key !== "Delete" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
  const target = event.target as Element | null;
  if (target !== event.currentTarget && !target?.closest?.(`[data-testid="more-${props.item.id}"]`)) return;
  event.preventDefault();
  panel.remove(props.item);
}

function onMenuKey(event: KeyboardEvent): void {
  if (event.key !== "Delete") return;
  event.preventDefault();
  menuOpen.value = false;
  panel.remove(props.item);
}

const canUp = computed(() => canMove(panel.store.list.value, props.item.id, -1));
const canDown = computed(() => canMove(panel.store.list.value, props.item.id, 1));

const icon = computed(() => (props.item.kind === "countdown" ? Hourglass : props.item.kind === "stopwatch" ? Timer : Hash));
const name = computed(() => props.item.label || t(`kind.${props.item.kind}`));

const reading = computed(() => (props.item.kind === "counter" ? null : readClock(props.item, panel.now.value)));
const display = computed(() => {
  const item = props.item;
  if (item.kind === "counter") return String(item.value);
  const now = reading.value!;
  if (now.done && item.doneText) return item.doneText;
  return formatSeconds(now.seconds, item.format);
});
const flashing = computed(() => !!reading.value?.done && props.item.kind === "countdown" && !props.item.doneText);

// What a counter adds to others ("+5 Sit-ups each") and where it is counted from ("from Deaths").
const label = (counter: { label: string }) => counter.label || t("kind.counter");
const adds = computed(() => {
  const counter = props.item;
  if (counter.kind !== "counter" || !counter.links.length) return "";
  const others = panel.store.list.value.items;
  const list = counter.links.map((link) => `${link.amount < 0 ? "−" : "+"}${Math.abs(link.amount)} ${label(others.find((other) => other.id === link.target) ?? { label: "" })}`);
  return t("item.adds", { list: list.join(", ") });
});
const from = computed(() => {
  if (props.item.kind !== "counter") return "";
  const sources = sourcesOf(panel.store.list.value, props.item.id);
  return sources.length ? t("item.from", { list: sources.map(label).join(", ") }) : "";
});
const hasSubline = computed(() => (props.item.kind === "counter" && props.item.goal !== null) || !!adds.value || !!from.value);

const laps = computed(() => (props.item.kind === "stopwatch" && props.item.laps ? lapSplits(props.item).map((ms, index) => ({ number: index + 1, ms })).reverse().slice(0, 5) : []));
const format = computed(() => (props.item.kind === "counter" ? "m:ss" : props.item.format));

const startLabel = computed(() => {
  const now = reading.value;
  if (!now) return "";
  if (now.done) return t("item.restart");
  return props.item.kind !== "counter" && props.item.since !== null ? t("item.pause") : t("item.start");
});
</script>

<template>
  <article class="bg-card rounded-lg border outline-none" tabindex="-1" :data-testid="`item-${item.id}`" @contextmenu="onContextMenu" @keydown="onKey">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pr-1.5 pl-3">
      <!-- Name and type. A small marker for linked counters ("also adds to") goes at the end of this block. -->
      <div class="flex min-w-24 flex-[1_1_6rem] items-center gap-2" data-testid="item-name">
        <component :is="icon" class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
        <div class="min-w-0">
          <h2 class="truncate text-sm font-medium" :title="name">{{ name }}</h2>
          <p v-if="hasSubline" class="text-muted-foreground flex gap-2 text-xs tabular-nums" data-testid="subline">
            <span v-if="item.kind === 'counter' && item.goal !== null" class="flex-none" :class="goalReached(item) && 'text-success'">
              <template v-if="goalReached(item)">{{ t("item.goalDone") }}&nbsp;</template><CountTo :value="item.value" :format="String" /> / {{ item.goal }}
            </span>
            <span v-if="adds" class="min-w-0 truncate" :title="adds" data-testid="adds">{{ adds }}</span>
            <span v-if="from" class="min-w-0 truncate" :title="from" data-testid="from">{{ from }}</span>
          </p>
        </div>
      </div>

      <span class="ml-auto min-w-0 flex-[0_1_auto] truncate text-right text-xl font-semibold tabular-nums" :class="flashing && 'clock-done'" data-testid="value"><CountTo v-if="item.kind === 'counter'" :value="item.value" :format="String" /><template v-else>{{ display }}</template></span>

      <div class="flex flex-none items-center gap-1">
        <template v-if="item.kind === 'counter'">
          <Button variant="secondary" size="icon-sm" :aria-label="t('item.down')" :title="t('item.down')" :disabled="!item.negative && item.value <= 0" @click="panel.act('down', item.id)">
            <Minus :stroke-width="1.5" />
          </Button>
          <Button variant="secondary" size="icon-sm" :aria-label="t('item.up')" :title="t('item.up')" data-testid="up" @click="panel.act('up', item.id)">
            <Plus :stroke-width="1.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" :aria-label="t('item.reset')" :title="t('item.reset')" data-testid="reset" @click="panel.act('reset', item.id)">
            <RotateCcw :stroke-width="1.5" />
          </Button>
        </template>

        <template v-else>
          <Button variant="secondary" size="icon-sm" :aria-label="startLabel" :title="startLabel" data-testid="start-pause" @click="panel.act('start-pause', item.id)">
            <Pause v-if="item.since !== null && !reading?.done" :stroke-width="1.5" />
            <Play v-else :stroke-width="1.5" />
          </Button>
          <Button v-if="item.kind === 'stopwatch' && item.laps" variant="ghost" size="icon-sm" :aria-label="t('item.lap')" :title="t('item.lap')" :disabled="item.since === null" @click="panel.act('lap', item.id)">
            <Flag :stroke-width="1.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" :aria-label="t('item.reset')" :title="t('item.reset')" data-testid="reset" @click="panel.act('reset', item.id)">
            <RotateCcw :stroke-width="1.5" />
          </Button>
        </template>

        <DropdownMenu v-model:open="menuOpen">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" :aria-label="t('item.more', { label: name })" :title="t('item.more', { label: name })" :data-testid="`more-${item.id}`">
              <Ellipsis :stroke-width="1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" @keydown="onMenuKey">
            <DropdownMenuItem :data-testid="`menu-settings-${item.id}`" @select="emit('toggleEdit')"><Settings :stroke-width="1.5" />{{ t("item.settings") }}</DropdownMenuItem>
            <DropdownMenuItem :disabled="!canUp" :data-testid="`menu-up-${item.id}`" @select="panel.move(item.id, -1)"><ArrowUp :stroke-width="1.5" />{{ t("item.moveUp") }}</DropdownMenuItem>
            <DropdownMenuItem :disabled="!canDown" :data-testid="`menu-down-${item.id}`" @select="panel.move(item.id, 1)"><ArrowDown :stroke-width="1.5" />{{ t("item.moveDown") }}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" :data-testid="`delete-${item.id}`" @select="panel.remove(item)">
              <Trash2 :stroke-width="1.5" />{{ t("edit.delete") }}<DropdownMenuShortcut>Del</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <ol v-if="laps.length" class="text-muted-foreground flex flex-col gap-0.5 border-t px-3 py-2 text-xs tabular-nums">
      <li v-for="lap in laps" :key="lap.number" class="flex justify-between gap-2">
        <span>{{ t("item.lapN", { number: String(lap.number) }) }}</span>
        <span>{{ formatSeconds(Math.floor(lap.ms / 1000), format) }}</span>
      </li>
    </ol>
  </article>
</template>
