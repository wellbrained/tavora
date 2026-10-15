<script setup lang="ts">
// Settings > Integrations > Steam: adding the games the player owns on Steam.
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { dialog, state } from "../../host";
import { t } from "../../i18n";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const online = computed(() => state.value?.library.onlineSearch ?? false);
</script>

<template>
  <section>
    <h3 class="text-lg font-semibold">{{ t("integrations.steam.title") }}</h3>
    <SettingRow
      class="mt-2"
      :label="t('settings.steam-import.label')"
      :description="t('settings.steam-import.description')"
      setting="steam-import"
      :highlighted="highlight === 'steam-import'"
    >
      <Button variant="secondary" data-testid="open-steam-import-settings" :disabled="!online" @click="dialog = { kind: 'steam-import' }">
        {{ t("settings.steamImport.button") }}
      </Button>
    </SettingRow>
  </section>
</template>
