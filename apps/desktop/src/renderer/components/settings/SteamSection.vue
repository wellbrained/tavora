<script setup lang="ts">
// Settings > Games > Steam: adding the games the player owns on Steam. Always first in Games.
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { dialog, state } from "../../host";
import { t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const online = computed(() => state.value?.library.onlineSearch ?? false);
</script>

<template>
  <SettingGroup :title="t('integrations.steam.title')">
    <SettingRow
      :label="t('settings.steam-import.label')"
      :description="t('settings.steam-import.description')"
      setting="steam-import"
      :highlighted="highlight === 'steam-import'"
    >
      <Button variant="secondary" data-testid="open-steam-import-settings" :disabled="!online" @click="dialog = { kind: 'steam-import' }">
        {{ t("settings.steamImport.button") }}
      </Button>
    </SettingRow>
  </SettingGroup>
</template>
