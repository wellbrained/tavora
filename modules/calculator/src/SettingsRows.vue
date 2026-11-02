<script setup lang="ts">
// The Calculator's one page of settings: the decimal places and short form results show with, and how many results the
// history keeps. Every change applies and saves at once. `stacked` puts each control under its name, for the narrow dialog
// an older Tavora shows in the middle of the panel.
import { SegmentedControl } from "@tavora/official-ui";
import { SettingsPage, SettingsRow, SettingsSection } from "@tavora/official-ui/components/ui/module-settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { computed } from "vue";
import { t } from "./i18n";
import { DECIMALS, HISTORY_LENGTHS, type Decimals } from "./settings";

defineProps<{ short: boolean; stacked?: boolean }>();
const emit = defineEmits<{ "update:short": [on: boolean] }>();
/** The kit's controls hand over strings; the panel turns them back into numbers. */
const decimals = defineModel<string>("decimals", { required: true });
const historyLength = defineModel<string>("historyLength", { required: true });

const decimalsLabel = (option: Decimals) => (option === "auto" ? t("options.decimalsAuto") : String(option));
const lengths = computed(() => HISTORY_LENGTHS.map((option) => ({ value: String(option), label: String(option), testid: `history-length-${option}` })));
</script>

<template>
  <SettingsPage :title="t('options.title')" :description="t('options.about')">
    <SettingsSection>
      <SettingsRow :label="t('options.decimals')" :hint="t('options.decimalsAbout')" :stacked="stacked">
        <Select v-model="decimals">
          <SelectTrigger class="w-full" :aria-label="t('options.decimals')" data-testid="options-decimals"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in DECIMALS" :key="option" :value="String(option)" :data-testid="`decimals-${option}`">
              {{ decimalsLabel(option) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow :label="t('options.short')" :hint="t('options.shortAbout')" :stacked="stacked">
        <Switch :model-value="short" :aria-label="t('options.short')" data-testid="options-short" @update:model-value="(on: boolean) => emit('update:short', on)" />
      </SettingsRow>
      <SettingsRow :label="t('options.historyLength')" :hint="t('options.historyLengthAbout')" :stacked="stacked">
        <SegmentedControl
          v-model="historyLength"
          :label="t('options.historyLength')"
          :options="lengths"
          class="w-full min-w-0 [&>*]:flex-1 [&>*]:px-0"
        />
      </SettingsRow>
    </SettingsSection>
  </SettingsPage>
</template>
