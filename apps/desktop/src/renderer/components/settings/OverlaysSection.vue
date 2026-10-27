<script setup lang="ts">
// Settings > Overlays: what Tavora shows over a game. The master switch and the global options (keep when you switch
// windows, the one key that opens the in-game layer). Arranging and pausing are in the workspace header's Overlay
// button; modules add overlays with "Show over game" and panels get "Show in game" in their menu.
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { hotkeyKeys } from "../../../shared/hotkey-keys";
import { act, state } from "../../host";
import { t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

const overlays = computed(() => state.value!.gameOverlays);
const mac = navigator.platform.startsWith("Mac");

const enabled = computed({
  get: () => overlays.value.enabled,
  set: (on: boolean) => void act({ type: "set-game-overlays", enabled: on }),
});

const stay = computed({
  get: () => overlays.value.stay,
  set: (on: boolean) => void act({ type: "set-overlays-stay", enabled: on }),
});

function askKey() {
  void act({ type: "set-overlay-key" });
}
</script>

<template>
  <SettingGroup :title="t('overlays.group.overlays')">
    <SettingRow :label="t('settings.game-overlays.label')" :description="t('settings.game-overlays.description')" setting="game-overlays" :highlighted="highlight === 'game-overlays'">
      <Switch v-model="enabled" :aria-label="t('settings.game-overlays.label')" data-testid="game-overlays" />
    </SettingRow>
    <SettingRow :label="t('settings.overlays-stay.label')" :description="t('settings.overlays-stay.description')" setting="overlays-stay" :highlighted="highlight === 'overlays-stay'">
      <Switch v-model="stay" :disabled="!enabled" :aria-label="t('settings.overlays-stay.label')" data-testid="overlays-stay" />
    </SettingRow>
    <SettingRow :label="t('settings.overlay-layer-key.label')" :description="t('settings.overlay-layer-key.description')" setting="overlay-layer-key" :highlighted="highlight === 'overlay-layer-key'">
      <template #below>
        <span v-if="overlays.layerKey?.taken" class="text-destructive text-sm">{{ t("overlays.key.taken") }}</span>
      </template>
      <span class="flex items-center gap-2">
        <span v-if="overlays.layerKey" class="flex flex-none items-center gap-1">
          <Kbd v-for="key in hotkeyKeys(overlays.layerKey.accelerator, mac)" :key="key">{{ key }}</Kbd>
        </span>
        <span v-else class="text-muted-foreground text-xs">{{ t("overlays.key.none") }}</span>
        <Button
          variant="secondary"
          size="sm"
          :aria-label="t(overlays.layerKey ? 'overlays.key.changeLabel' : 'overlays.key.setLabel', { name: t('settings.overlay-layer-key.label') })"
          data-testid="overlay-layer-key"
          @click="askKey()"
        >
          {{ overlays.layerKey ? t("overlays.key.change") : t("overlays.key.set") }}
        </Button>
      </span>
    </SettingRow>
  </SettingGroup>
</template>
