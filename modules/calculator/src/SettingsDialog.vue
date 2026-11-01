<script setup lang="ts">
// The Calculator's settings, in a dialog in the middle of the panel: the decimal places and short form results show
// with, and how many results the history keeps. Every change applies and saves at once.
import { SegmentedControl } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { computed } from "vue";
import { t } from "./i18n";
import { DECIMALS, HISTORY_LENGTHS, type Decimals } from "./settings";

defineProps<{ short: boolean }>();
const emit = defineEmits<{ "update:short": [on: boolean]; close: [] }>();
/** The kit's controls hand over strings; the panel turns them back into numbers. */
const decimals = defineModel<string>("decimals", { required: true });
const historyLength = defineModel<string>("historyLength", { required: true });

const decimalsLabel = (option: Decimals) => (option === "auto" ? t("options.decimalsAuto") : String(option));
const lengths = computed(() => HISTORY_LENGTHS.map((option) => ({ value: String(option), label: String(option), testid: `history-length-${option}` })));
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('close')">
    <DialogContent class="gap-4 sm:max-w-[360px]" data-testid="settings-dialog">
      <DialogHeader>
        <DialogTitle class="text-lg">{{ t("options.title") }}</DialogTitle>
      </DialogHeader>
      <div class="flex flex-col">
        <div class="border-border/70 flex min-h-12 items-center justify-between gap-4 border-b py-2">
          <span id="calc-decimals" class="text-sm">{{ t("options.decimals") }}</span>
          <Select v-model="decimals">
            <SelectTrigger class="w-24" aria-labelledby="calc-decimals" data-testid="options-decimals"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in DECIMALS" :key="option" :value="String(option)" :data-testid="`decimals-${option}`">
                {{ decimalsLabel(option) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label class="border-border/70 flex min-h-12 items-center justify-between gap-4 border-b py-2">
          <span class="text-sm">{{ t("options.short") }}</span>
          <Switch :model-value="short" data-testid="options-short" @update:model-value="(on: boolean) => emit('update:short', on)" />
        </label>
        <div class="flex min-h-12 items-center justify-between gap-4 py-2">
          <span class="text-sm">{{ t("options.historyLength") }}</span>
          <SegmentedControl v-model="historyLength" :label="t('options.historyLength')" :options="lengths" />
        </div>
      </div>
      <div class="flex justify-end">
        <Button data-testid="settings-done" @click="emit('close')">{{ t("done") }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
