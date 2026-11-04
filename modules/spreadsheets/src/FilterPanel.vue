<script setup lang="ts">
// One column's filter, opened from its ▾ in the header row: a text it must contain, a number range, ticked or not
// for checkboxes, and the values to show. It only hides rows; changes apply at once.
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Label } from "@tavora/official-ui/components/ui/label";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { computed, inject } from "vue";
import { PANEL } from "./context";
import { parseLocalNumber, localNumber } from "./display";
import { columnName } from "./formula/refs";
import { t } from "./i18n";
import type { ColumnFilter } from "./model";

const props = defineProps<{ col: number }>();
const panel = inject(PANEL)!;
const session = computed(() => panel.session.value!);
const filter = computed<ColumnFilter>(() => {
  void session.value.version.value;
  return session.value.columnFilter(props.col);
});
const values = computed(() => {
  void session.value.version.value;
  return session.value.columnValues(props.col);
});
const isCheckbox = computed(() => session.value.formatOf(1, props.col).type === "checkbox");
const lang = computed(() => panel.lang.value);

// Only what was changed is written; the rest of the saved filter stays as it is.
const update = (change: Partial<ColumnFilter>) => session.value.updateColumnFilter(props.col, change);
const shown = (value: string) => !filter.value.hidden.includes(value);
const toggleValue = (value: string, on: boolean) => update({ hidden: on ? filter.value.hidden.filter((item) => item !== value) : [...filter.value.hidden, value] });
const allShown = computed(() => filter.value.hidden.length === 0);
const toggleAll = (on: boolean) => update({ hidden: on ? [] : [...values.value] });

const numberText = (value: number | null) => (value === null ? "" : localNumber(value, lang.value));
const setNumber = (key: "min" | "max", text: string) => update({ [key]: text.trim() === "" ? null : parseLocalNumber(text, lang.value) });
const checked = computed({
  get: () => (filter.value.checked === null ? "any" : filter.value.checked ? "yes" : "no"),
  set: (value: string) => update({ checked: value === "any" ? null : value === "yes" }),
});
const checkOptions = computed(() => [
  { value: "any", label: t("filter.any") },
  { value: "yes", label: t("filter.ticked") },
  { value: "no", label: t("filter.unticked") },
]);
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="filter-panel">
    <p class="text-sm font-medium">{{ t("filter.title", { column: columnName(col) }) }}</p>
    <div class="flex flex-col gap-1.5">
      <Label :for="`filter-contains-${col}`">{{ t("filter.contains") }}</Label>
      <Input :id="`filter-contains-${col}`" :model-value="filter.contains" class="h-8" @update:model-value="(value) => update({ contains: String(value) })" />
    </div>
    <div v-if="isCheckbox" class="flex flex-col gap-1.5">
      <SegmentedControl v-model="checked" :options="checkOptions" :label="t('format.checkbox')" class="w-full [&>*]:flex-1" />
    </div>
    <div v-else class="grid grid-cols-2 gap-2">
      <div class="flex flex-col gap-1.5">
        <Label :for="`filter-min-${col}`">{{ t("filter.from") }}</Label>
        <Input :id="`filter-min-${col}`" :model-value="numberText(filter.min)" inputmode="decimal" class="h-8" @change="(event: Event) => setNumber('min', (event.target as HTMLInputElement).value)" />
      </div>
      <div class="flex flex-col gap-1.5">
        <Label :for="`filter-max-${col}`">{{ t("filter.to") }}</Label>
        <Input :id="`filter-max-${col}`" :model-value="numberText(filter.max)" inputmode="decimal" class="h-8" @change="(event: Event) => setNumber('max', (event.target as HTMLInputElement).value)" />
      </div>
    </div>
    <div class="flex flex-col gap-1.5">
      <p class="text-xs text-muted-foreground">{{ t("filter.values") }}</p>
      <div class="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1">
        <label class="flex items-center gap-2 text-sm">
          <Checkbox :model-value="allShown" @update:model-value="(on) => toggleAll(on === true)" />
          {{ t("filter.all") }}
        </label>
        <label v-for="value in values" :key="value" class="flex items-center gap-2 text-sm">
          <Checkbox :model-value="shown(value)" @update:model-value="(on) => toggleValue(value, on === true)" />
          <span class="min-w-0 truncate">{{ value === "" ? t("filter.blank") : value }}</span>
        </label>
      </div>
    </div>
    <Button variant="ghost" size="sm" class="self-start" @click="session.setColumnFilter(col, null)">{{ t("filter.reset") }}</Button>
  </div>
</template>
