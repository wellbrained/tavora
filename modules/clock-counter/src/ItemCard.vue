<script setup lang="ts">
// One clock or counter: its name, the big time or number, and the buttons to run it. The gear opens its settings
// below it; what is open is this panel's own.
import { Flag, Minus, Pause, Play, Plus, RotateCcw, Settings2, Timer, Hourglass, Hash } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { computed, inject } from "vue";
import { t } from "./i18n";
import ItemEditor from "./ItemEditor.vue";
import { goalReached, lapSplits, readClock, type Item } from "./items";
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
  <article class="bg-card flex flex-col rounded-lg border" :data-testid="`item-${item.id}`">
    <header class="flex items-center gap-2 py-1.5 pr-1 pl-3">
      <component :is="icon" class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
      <h2 class="min-w-0 flex-1 truncate text-sm font-medium" :title="name">{{ name }}</h2>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="editing ? t('item.closeEdit') : t('item.edit', { label: name })"
        :title="editing ? t('item.closeEdit') : t('item.edit', { label: name })"
        :aria-expanded="editing"
        :data-testid="`edit-${item.id}`"
        @click="emit('toggleEdit')"
      >
        <Settings2 :stroke-width="1.5" />
      </Button>
    </header>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-3">
      <template v-if="item.kind === 'counter'">
        <Button variant="secondary" size="icon" :aria-label="t('item.down')" :title="t('item.down')" :disabled="!item.negative && item.value <= 0" @click="panel.act('down', item.id)">
          <Minus :stroke-width="1.5" />
        </Button>
        <span class="min-w-0 flex-1 text-center">
          <span class="block truncate text-3xl font-semibold tabular-nums" data-testid="value">{{ display }}</span>
          <span v-if="item.goal !== null" class="text-muted-foreground text-xs tabular-nums" :class="goalReached(item) && 'text-success'">
            {{ goalReached(item) ? t("item.goalDone") : "" }} {{ item.value }} / {{ item.goal }}
          </span>
        </span>
        <Button variant="secondary" size="icon" :aria-label="t('item.up')" :title="t('item.up')" data-testid="up" @click="panel.act('up', item.id)">
          <Plus :stroke-width="1.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" :aria-label="t('item.reset')" :title="t('item.reset')" @click="panel.act('reset', item.id)">
          <RotateCcw :stroke-width="1.5" />
        </Button>
      </template>

      <template v-else>
        <span class="min-w-0 flex-1 truncate text-3xl font-semibold tabular-nums" :class="flashing && 'clock-done'" data-testid="value">{{ display }}</span>
        <Button variant="secondary" size="icon" :aria-label="startLabel" :title="startLabel" data-testid="start-pause" @click="panel.act('start-pause', item.id)">
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
    </div>

    <ol v-if="laps.length" class="text-muted-foreground flex flex-col gap-0.5 border-t px-3 py-2 text-xs tabular-nums">
      <li v-for="lap in laps" :key="lap.number" class="flex justify-between gap-2">
        <span>{{ t("item.lapN", { number: String(lap.number) }) }}</span>
        <span>{{ formatSeconds(Math.floor(lap.ms / 1000), format) }}</span>
      </li>
    </ol>

    <ItemEditor v-if="editing" :item="item" :first="first" :last="last" />
  </article>
</template>
