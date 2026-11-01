<script setup lang="ts">
// One clock or counter as a single compact row: its name, the time or number, the buttons to run it, and a gear that
// opens its settings in a dialog over the workspace; what is open is this panel's own. On a very narrow panel the row wraps to two lines.
import { Flag, Hash, Hourglass, Minus, Pause, Play, Plus, RotateCcw, Settings, Timer } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { computed, inject } from "vue";
import { t } from "./i18n";
import ItemEditor from "./ItemEditor.vue";
import { goalReached, lapSplits, readClock, sourcesOf, type Item } from "./items";
import { PANEL } from "./panel";
import { formatSeconds } from "./time";

const props = defineProps<{ item: Item; editing: boolean; first: boolean; last: boolean }>();
const emit = defineEmits<{ toggleEdit: [] }>();
const panel = inject(PANEL)!;

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
  <article class="bg-card rounded-lg border" :data-testid="`item-${item.id}`">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pr-1.5 pl-3">
      <!-- Name and type. A small marker for linked counters ("also adds to") goes at the end of this block. -->
      <div class="flex min-w-24 flex-[1_1_6rem] items-center gap-2" data-testid="item-name">
        <component :is="icon" class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
        <div class="min-w-0">
          <h2 class="truncate text-sm font-medium" :title="name">{{ name }}</h2>
          <p v-if="hasSubline" class="text-muted-foreground flex gap-2 text-xs tabular-nums" data-testid="subline">
            <span v-if="item.kind === 'counter' && item.goal !== null" class="flex-none" :class="goalReached(item) && 'text-success'">
              <template v-if="goalReached(item)">{{ t("item.goalDone") }}&nbsp;</template>{{ item.value }} / {{ item.goal }}
            </span>
            <span v-if="adds" class="min-w-0 truncate" :title="adds" data-testid="adds">{{ adds }}</span>
            <span v-if="from" class="min-w-0 truncate" :title="from" data-testid="from">{{ from }}</span>
          </p>
        </div>
      </div>

      <span class="ml-auto min-w-0 flex-[0_1_auto] truncate text-right text-xl font-semibold tabular-nums" :class="flashing && 'clock-done'" data-testid="value">{{ display }}</span>

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

        <Button variant="ghost" size="icon-sm" :aria-label="t('item.edit', { label: name })" :title="t('item.edit', { label: name })" aria-haspopup="dialog" :data-testid="`edit-${item.id}`" @click="emit('toggleEdit')">
          <Settings :stroke-width="1.5" />
        </Button>
      </div>
    </div>

    <ol v-if="laps.length" class="text-muted-foreground flex flex-col gap-0.5 border-t px-3 py-2 text-xs tabular-nums">
      <li v-for="lap in laps" :key="lap.number" class="flex justify-between gap-2">
        <span>{{ t("item.lapN", { number: String(lap.number) }) }}</span>
        <span>{{ formatSeconds(Math.floor(lap.ms / 1000), format) }}</span>
      </li>
    </ol>

    <!-- Only for a Tavora that can't show the settings over the workspace: a dialog in the middle of the panel. -->
    <Dialog v-if="editing" :open="true" @update:open="(open: boolean) => !open && emit('toggleEdit')">
      <DialogContent class="max-h-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-4">
        <DialogHeader>
          <DialogTitle class="truncate pr-6 text-lg">{{ t("item.edit", { label: name }) }}</DialogTitle>
        </DialogHeader>
        <ItemEditor :item="item" :first="first" :last="last" @close="emit('toggleEdit')" />
      </DialogContent>
    </Dialog>
  </article>
</template>
