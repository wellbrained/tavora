<script setup lang="ts">
// Settings > General: the language, where Tavora starts and the welcome tour. What happens when a game starts or
// closes, and the rail's order, are in Settings > Games.
import { computed, ref, watch } from "vue";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import type { Startup } from "../../../shared/host-api";
import { LANGUAGES, type LanguageSetting } from "../../../shared/i18n";
import { act, settingsOpen, state, trialWelcome, useFloating } from "../../host";
import { t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const library = computed(() => state.value!.library);
const startup = computed({
  get: () => library.value.startup,
  set: (value: Startup) => void act({ type: "set-startup", startup: value }),
});
const languageSetting = computed({
  get: () => state.value!.language.setting,
  set: (value: LanguageSetting) => void act({ type: "set-language", language: value }),
});
/** Follow System first, then the languages in their own names. */
const languageOptions = computed(() => [
  { value: "system" as LanguageSetting, label: t("settings.language.system"), keywords: "system follow auto automatic" },
  ...LANGUAGES.map((item) => ({ value: item.id as LanguageSetting, label: item.name, keywords: `${item.id} ${item.search}` })),
]);

// An open list floats over the panels, like a menu.
const languageOpen = ref(false);
const trackLanguage = useFloating();
watch(languageOpen, trackLanguage);

/** Leaves Settings and Home shows the first-run welcome again. */
async function showWelcomeAgain() {
  const result = await act({ type: "set-onboarded", done: false });
  if (!result.ok) return;
  settingsOpen.value = false;
  await act({ type: "show-welcome" });
}
/** Dev build: shows the welcome as a dry run. Only the screen changes, so panels do not float over it; the library is not touched. */
async function tryWelcome() {
  if (!state.value?.devBuild) return;
  settingsOpen.value = false;
  await act({ type: "show-welcome" });
  trialWelcome.value = true;
}
</script>

<template>
  <SettingGroup>
    <SettingRow :label="t('settings.language.label')" :description="t('settings.language.description')" setting="language" :highlighted="highlight === 'language'">
      <Picker
        v-model="languageSetting"
        v-model:open="languageOpen"
        :options="languageOptions"
        :label="t('settings.language.label')"
        :search="t('settings.language.searchPlaceholder')"
        :empty="t('settings.language.none')"
        class="max-w-none"
        testid="language"
        data-testid="language-picker"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.startup.label')"
      :description="t('settings.startup.description')"
      :details="t('settings.startup.details')"
      setting="startup"
      :highlighted="highlight === 'startup'"
    >
      <SegmentedControl
        v-model="startup"
        :label="t('settings.startup.label')"
        :options="[
          { value: 'welcome', label: t('settings.startup.home'), testid: 'startup-welcome' },
          { value: 'last-workspace', label: t('settings.startup.lastWorkspace'), testid: 'startup-last-workspace' },
        ]"
      />
    </SettingRow>
    <SettingRow :label="t('settings.welcome-tour.label')" :description="t('settings.welcome-tour.description')" setting="welcome-tour" :highlighted="highlight === 'welcome-tour'">
      <Button variant="secondary" data-testid="show-welcome-again" @click="showWelcomeAgain">{{ t("settings.welcome.button") }}</Button>
    </SettingRow>
    <!-- Only in a build run from source: the whole welcome as a dry run that writes nothing. -->
    <SettingRow v-if="state!.devBuild" :label="t('settings.welcome-trial.label')" :description="t('settings.welcome-trial.description')">
      <Button variant="secondary" data-testid="try-welcome" @click="tryWelcome">{{ t("settings.welcome-trial.button") }}</Button>
    </SettingRow>
  </SettingGroup>
</template>
