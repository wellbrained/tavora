<script setup lang="ts">
// Settings > General: the language, where Tavora starts, the rail's order and the welcome tour.
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import type { RootSort, Startup } from "../../../shared/host-api";
import type { LanguageSetting } from "../../../shared/i18n";
import { act, settingsOpen, state } from "../../host";
import { t } from "../../i18n";
import LanguagePicker from "./LanguagePicker.vue";
import SegmentedControl from "./SegmentedControl.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const library = computed(() => state.value!.library);
const startup = computed({
  get: () => library.value.startup,
  set: (value: Startup) => void act({ type: "set-startup", startup: value }),
});
const sort = computed({
  get: () => library.value.sort,
  set: (value: RootSort) => void act({ type: "set-sort", sort: value }),
});
const languageSetting = computed({
  get: () => state.value!.language.setting,
  set: (value: LanguageSetting) => void act({ type: "set-language", language: value }),
});

/** Leaves Settings and Home shows the first-run welcome again. */
async function showWelcomeAgain() {
  const result = await act({ type: "set-onboarded", done: false });
  if (!result.ok) return;
  settingsOpen.value = false;
  await act({ type: "show-welcome" });
}
</script>

<template>
  <SettingGroup>
    <SettingRow :label="t('settings.language.label')" :description="t('settings.language.description')" setting="language" :highlighted="highlight === 'language'">
      <LanguagePicker v-model="languageSetting" />
    </SettingRow>
    <SettingRow :label="t('settings.startup.label')" :description="t('settings.startup.description')" setting="startup" :highlighted="highlight === 'startup'">
      <SegmentedControl
        v-model="startup"
        :label="t('settings.startup.label')"
        :options="[
          { value: 'welcome', label: t('settings.startup.home'), testid: 'startup-welcome' },
          { value: 'last-game', label: t('settings.startup.lastGame'), testid: 'startup-last-game' },
        ]"
      />
    </SettingRow>
    <SettingRow :label="t('settings.sort.label')" :description="t('settings.sort.description')" setting="sort" :highlighted="highlight === 'sort'">
      <SegmentedControl
        v-model="sort"
        :label="t('settings.sort.label')"
        :options="[
          { value: 'recent', label: t('settings.sort.recent'), testid: 'sort-recent' },
          { value: 'manual', label: t('settings.sort.manual'), testid: 'sort-manual' },
        ]"
      />
    </SettingRow>
    <SettingRow :label="t('settings.welcome-tour.label')" :description="t('settings.welcome-tour.description')" setting="welcome-tour" :highlighted="highlight === 'welcome-tour'">
      <Button variant="secondary" data-testid="show-welcome-again" @click="showWelcomeAgain">{{ t("settings.welcome.button") }}</Button>
    </SettingRow>
  </SettingGroup>
</template>
