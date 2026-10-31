<script setup lang="ts">
// Settings > Games: what happens when a game starts or closes, the library (the rail's order, every workspace and
// the Trash, each a page of its own, and the Steam import), and what Tavora asks its service for (game search,
// icons, the module catalog).
import { computed, ref, watch } from "vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import type { GameStart, RootSort } from "../../../shared/host-api";
import { act, dialog, state, useFloating } from "../../host";
import { t } from "../../i18n";
import type { SettingsSection } from "./settings-index";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();
const emit = defineEmits<{ show: [section: SettingsSection] }>();

const library = computed(() => state.value!.library);
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
const onlineSearch = computed({
  get: () => library.value.onlineSearch,
  set: (enabled: boolean) => void act({ type: "set-online-search", enabled }),
});
const steamIcons = computed({
  get: () => library.value.steamIcons,
  set: (enabled: boolean) => void act({ type: "set-steam-icons", enabled }),
});
const workspaceCount = computed(() => Object.keys(library.value.workspaces).length);

// An open list floats over the panels, like a menu.
const gameEndOpen = ref(false);
const trackGameEnd = useFloating();
watch(gameEndOpen, trackGameEnd);
</script>

<template>
  <SettingGroup :title="t('settings.heading.whenYouPlay')">
    <SettingRow
      :label="t('settings.game-start.label')"
      :description="t('settings.game-start.description')"
      :details="t('settings.game-start.details')"
      setting="game-start"
      :highlighted="highlight === 'game-start'"
    >
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
  </SettingGroup>

  <SettingGroup :title="t('settings.heading.library')">
    <SettingRow :label="t('settings.sort.label')" :description="t('settings.sort.description')" :details="t('settings.sort.details')" setting="sort" :highlighted="highlight === 'sort'">
      <SegmentedControl
        v-model="sort"
        :label="t('settings.sort.label')"
        :options="[
          { value: 'recent', label: t('settings.sort.recent'), testid: 'sort-recent' },
          { value: 'manual', label: t('settings.sort.manual'), testid: 'sort-manual' },
        ]"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.section.workspaces')"
      :description="t('settings.workspaces.summary', { count: workspaceCount })"
      opens
      data-testid="games-open-workspaces"
      @open="emit('show', 'workspaces')"
    />
    <SettingRow
      :label="t('settings.section.trash')"
      :description="library.trash.length ? t('settings.trash.summary', { count: library.trash.length }) : t('settings.trash.summaryEmpty')"
      opens
      data-testid="games-open-trash"
      @open="emit('show', 'trash')"
    >
      <template v-if="library.trash.length" #badges>
        <Badge variant="secondary" class="py-0 tabular-nums">{{ library.trash.length }}</Badge>
      </template>
    </SettingRow>
    <SettingRow
      :label="t('settings.steam-import.label')"
      :description="t('settings.steam-import.description')"
      :details="t('settings.steam-import.details')"
      setting="steam-import"
      :highlighted="highlight === 'steam-import'"
    >
      <Button variant="secondary" data-testid="open-steam-import-settings" :disabled="!library.onlineSearch" @click="dialog = { kind: 'steam-import' }">
        {{ t("settings.steamImport.button") }}
      </Button>
    </SettingRow>
  </SettingGroup>

  <SettingGroup :title="t('settings.section.online')">
    <SettingRow
      :label="t('settings.online-search.label')"
      :description="t('settings.online-search.description')"
      :details="t('settings.online-search.details')"
      setting="online-search"
      :highlighted="highlight === 'online-search'"
    >
      <Switch v-model="onlineSearch" :aria-label="t('settings.online-search.label')" data-testid="online-search" />
    </SettingRow>
    <SettingRow
      :label="t('settings.steam-icons.label')"
      :description="t('settings.steam-icons.description')"
      :details="t('settings.steam-icons.details')"
      setting="steam-icons"
      :highlighted="highlight === 'steam-icons'"
    >
      <Switch v-model="steamIcons" :aria-label="t('settings.steam-icons.label')" data-testid="steam-icons" />
    </SettingRow>
    <SettingRow
      :label="t('settings.share-icons.label')"
      :description="t('settings.share-icons.description')"
      :details="t('settings.share-icons.details')"
      setting="share-icons"
      :highlighted="highlight === 'share-icons'"
    >
      <Button variant="secondary" data-testid="open-share-icons" :disabled="!library.onlineSearch || !library.steamIcons" @click="dialog = { kind: 'share-icons', workspaceIds: [] }">
        {{ t("settings.shareIcons.button") }}
      </Button>
    </SettingRow>
  </SettingGroup>
</template>
