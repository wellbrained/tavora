<script setup lang="ts">
// Sort by one or more columns: the first decides, the next ones break ties. The header row stays put.
import { ArrowDownUp, Plus, X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogButton, DialogContent, DialogFooter, DialogHeader } from "@tavora/official-ui/components/ui/dialog";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { computed, ref, watch } from "vue";
import { columnName } from "./formula/refs";
import { t } from "./i18n";
import type { SortKey } from "./table";

const props = defineProps<{ columns: number; start: number; names: string[] }>();
const open = defineModel<boolean>("open", { required: true });
const emit = defineEmits<{ sort: [keys: SortKey[]] }>();

const keys = ref<{ col: string; direction: "az" | "za" }[]>([]);
watch(open, (isOpen) => isOpen && (keys.value = [{ col: String(props.start), direction: "az" }]), { immediate: true });

/** "A · Item" when the header row names the column. */
const label = (col: number) => (props.names[col] ? `${columnName(col)} · ${props.names[col]}` : t("sortDialog.column", { name: columnName(col) }));
const columns = computed(() => Array.from({ length: props.columns }, (_, col) => ({ value: String(col), label: label(col) })));
const directions = computed(() => [
  { value: "az" as const, label: t("sortDialog.az") },
  { value: "za" as const, label: t("sortDialog.za") },
]);

function sort() {
  emit("sort", keys.value.map((key) => ({ col: Number(key.col), descending: key.direction === "za" })));
  open.value = false;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader :icon="ArrowDownUp" :title="t('sortDialog.title')" :description="t('sortDialog.text')" />
      <form class="contents" @submit.prevent="sort">
        <div class="flex flex-col gap-2">
          <div v-for="(key, index) in keys" :key="index" class="flex items-center gap-2">
            <span class="w-20 flex-none text-sm text-muted-foreground">{{ index === 0 ? t("sortDialog.by") : t("sortDialog.then") }}</span>
            <Select v-model="key.col">
              <SelectTrigger class="h-8 min-w-0 flex-1" :aria-label="index === 0 ? t('sortDialog.by') : t('sortDialog.then')"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="column in columns" :key="column.value" :value="column.value">{{ column.label }}</SelectItem>
              </SelectContent>
            </Select>
            <SegmentedControl v-model="key.direction" :options="directions" :label="t('sortDialog.title')" />
            <Button type="button" variant="ghost" size="icon-sm" :aria-label="t('sortDialog.remove')" :title="t('sortDialog.remove')" :disabled="keys.length <= 1" @click="keys.splice(index, 1)"><X :stroke-width="1.5" /></Button>
          </div>
          <Button type="button" variant="ghost" size="sm" class="self-start" :disabled="keys.length >= 3" @click="keys.push({ col: String(Math.min(columns.length - 1, Number(keys.at(-1)!.col) + 1)), direction: 'az' })"><Plus :stroke-width="1.5" /> {{ t("sortDialog.add") }}</Button>
        </div>
        <DialogFooter>
          <DialogButton close>{{ t("cancel") }}</DialogButton>
          <DialogButton type="submit" :icon="ArrowDownUp">{{ t("sortDialog.title") }}</DialogButton>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
