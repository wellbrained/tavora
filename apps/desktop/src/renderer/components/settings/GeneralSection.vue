<script setup lang="ts">
// Settings > General: the language, where Tavora starts, what happens when a game starts or closes,
// the rail's order and the welcome tour.
import { computed, ref, watch } from "vue";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import type { GameStart, RootSort, Startup } from "../../../shared/host-api";
import { LANGUAGES, type LanguageSetting } from "../../../shared/i18n";
import { act, settingsOpen, state, useFloating } from "../../host";
import { t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const library = computed(() => state.value!.library);
const startup = computed({
  get: () => library.value.startup,
  set: (value: Startup) => void act({ type: "set-startup", startup: value }),
});
const gameStart = computed({
  get: () => library.value.gameStart,
  set: (value: GameStart) => void act({ type: "set-game-start", gameStart: value }),
});
/** Not a workspace id, so it can stand for staying where the user is. */
const STAY = ":stay";
const gameEnd = computed({
  get: () => library.value.gameEndWorkspaceId ?? STAY,
  set: (value: string) => void act({ type: "set-game-end", workspaceId: value === STAY ? null : value }),
});
const gameEndOptions = computed(() => [
  { value: STAY, label: t("settings.game-end.stay") },
  ...Object.values(library.value.workspaces)
    .filter((entry) => entry.kind === "personal")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({ value: entry.id, label: entry.name })),
]);
const sort = computed({
  get: () => library.value.sort,
  set: (value: RootSort) => void act({ type: "set-sort", sort: value }),
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
const gameEndOpen = ref(false);
const trackLanguage = useFloating();
const trackGameEnd = useFloating();
watch(languageOpen, trackLanguage);
watch(gameEndOpen, trackGameEnd);

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
    <SettingRow :label="t('settings.startup.label')" :description="t('settings.startup.description')" setting="startup" :highlighted="highlight === 'startup'">
      <SegmentedControl
        v-model="startup"
        :label="t('settings.startup.label')"
        :options="[
          { value: 'welcome', label: t('settings.startup.home'), testid: 'startup-welcome' },
          { value: 'last-workspace', label: t('settings.startup.lastWorkspace'), testid: 'startup-last-workspace' },
        ]"
      />
    </SettingRow>
    <SettingRow :label="t('settings.game-start.label')" :description="t('settings.game-start.description')" setting="game-start" :highlighted="highlight === 'game-start'">
      <SegmentedControl
        v-model="gameStart"
        :label="t('settings.game-start.label')"
        :options="[
          { value: 'switch', label: t('settings.game-start.switch'), testid: 'game-start-switch' },
          { value: 'ask', label: t('settings.game-start.ask'), testid: 'game-start-ask' },
          { value: 'show', label: t('settings.game-start.show'), testid: 'game-start-show' },
          { value: 'off', label: t('settings.game-start.off'), testid: 'game-start-off' },
        ]"
      />
    </SettingRow>
    <SettingRow
      v-if="gameStart !== 'off'"
      :label="t('settings.game-end.label')"
      :description="t('settings.game-end.description')"
      setting="game-end"
      :highlighted="highlight === 'game-end'"
    >
      <Picker v-model="gameEnd" v-model:open="gameEndOpen" :options="gameEndOptions" :label="t('settings.game-end.label')" testid="game-end" data-testid="game-end" />
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
