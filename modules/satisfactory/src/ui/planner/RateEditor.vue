<script setup lang="ts">
// A list of items with a rate per minute each, plus a search to add one.
// The Planner uses it for its targets and for what is already supplied.
import { X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { ref, watch } from "vue";
import type { Rate } from "../../contracts/plan";
import { language, locale, t } from "../../i18n";
import GameIcon from "../common/GameIcon.vue";
import { useModule, useNames } from "../context";
import { formatInput } from "../format";
import ItemCombobox from "../local/ItemCombobox.vue";
import { addRate, defaultRate, parseRate, removeRate, setRate } from "../planEdit";
import { itemTooltip } from "../tooltip";

const props = defineProps<{ rates: Rate[]; addLabel: string; filter?: (item: string) => boolean }>();
const emit = defineEmits<{ change: [rates: Rate[]] }>();

const context = useModule();
const { data } = context.services;
const vTip = context.tip;
const names = useNames(context);

/** What the player typed per item, so a half-typed "1," stays as it is. */
const drafts = ref<Record<string, string>>({});
const shown = (rate: Rate) => drafts.value[rate.item] ?? formatInput(rate.perMinute, locale());
const isFluid = (item: string) => data.items[item]?.form !== "solid" && data.items[item] !== undefined;

watch(
  () => props.rates,
  (rates) => {
    // Drop drafts of removed items, and of items another panel changed.
    const next: Record<string, string> = {};
    for (const rate of rates) {
      const draft = drafts.value[rate.item];
      if (draft !== undefined && parseRate(draft) === rate.perMinute) next[rate.item] = draft;
    }
    drafts.value = next;
  },
);

function onRateInput(index: number, rate: Rate, text: string) {
  drafts.value = { ...drafts.value, [rate.item]: text };
  const value = parseRate(text);
  if (value !== null && value !== rate.perMinute) emit("change", setRate(props.rates, index, value));
}

function onRateBlur(rate: Rate) {
  const { [rate.item]: _, ...rest } = drafts.value;
  drafts.value = rest;
}

function add(item: string) {
  emit("change", addRate(props.rates, item, props.rates.find((rate) => rate.item === item)?.perMinute ?? defaultRate(data, item)));
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <ul v-if="rates.length" class="flex flex-col gap-1" role="list">
      <li v-for="(rate, index) in rates" :key="rate.item" class="flex min-w-0 items-center gap-2" data-testid="rate-row">
        <span v-tip="() => itemTooltip(data, rate.item, language, locale(), t)" class="flex min-w-0 flex-1 items-center gap-2">
          <GameIcon :icon="data.items[rate.item]?.icon" :size="24" />
          <span class="min-w-0 truncate text-sm">{{ names.item(rate.item) }}</span>
        </span>
        <Input
          :model-value="shown(rate)"
          inputmode="decimal"
          class="h-7 w-24 flex-none text-right tabular-nums"
          :aria-label="t('planner.rateFor', { item: names.item(rate.item) })"
          :aria-invalid="parseRate(shown(rate)) === null ? true : undefined"
          data-testid="rate-input"
          @update:model-value="(value: string | number) => onRateInput(index, rate, String(value))"
          @blur="onRateBlur(rate)"
        />
        <span class="text-muted-foreground w-12 flex-none text-xs">{{ isFluid(rate.item) ? t("perMinuteFluid") : t("perMinute") }}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          class="flex-none"
          :aria-label="t('planner.remove', { item: names.item(rate.item) })"
          :title="t('planner.remove', { item: names.item(rate.item) })"
          data-testid="rate-remove"
          @click="emit('change', removeRate(rates, index))"
        >
          <X :stroke-width="1.5" />
        </Button>
      </li>
    </ul>
    <ItemCombobox :label="addLabel" :filter="filter" @pick="add" />
  </div>
</template>
