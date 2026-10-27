<script setup lang="ts">
// Settings > Online: what Tavora asks its service for (game search, icons, the module catalog),
// the game icons, and sharing icons the service is missing.
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { act, dialog, state } from "../../host";
import { t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const library = computed(() => state.value!.library);
const onlineSearch = computed({
  get: () => library.value.onlineSearch,
  set: (enabled: boolean) => void act({ type: "set-online-search", enabled }),
});
const steamIcons = computed({
  get: () => library.value.steamIcons,
  set: (enabled: boolean) => void act({ type: "set-steam-icons", enabled }),
});
</script>

<template>
  <SettingGroup>
    <SettingRow :label="t('settings.online-search.label')" :description="t('settings.online-search.description')" setting="online-search" :highlighted="highlight === 'online-search'">
      <Switch v-model="onlineSearch" :aria-label="t('settings.online-search.label')" data-testid="online-search" />
    </SettingRow>
  </SettingGroup>
  <SettingGroup :title="t('settings.heading.icons')">
    <SettingRow :label="t('settings.steam-icons.label')" :description="t('settings.steam-icons.description')" setting="steam-icons" :highlighted="highlight === 'steam-icons'">
      <Switch v-model="steamIcons" :aria-label="t('settings.steam-icons.label')" data-testid="steam-icons" />
    </SettingRow>
    <SettingRow :label="t('settings.share-icons.label')" :description="t('settings.share-icons.description')" setting="share-icons" :highlighted="highlight === 'share-icons'">
      <Button variant="secondary" data-testid="open-share-icons" :disabled="!library.onlineSearch || !library.steamIcons" @click="dialog = { kind: 'share-icons', workspaceIds: [] }">
        {{ t("settings.shareIcons.button") }}
      </Button>
    </SettingRow>
  </SettingGroup>
</template>
