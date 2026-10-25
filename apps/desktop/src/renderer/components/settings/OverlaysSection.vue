<script setup lang="ts">
// Settings > Overlays: what Tavora shows over a game. The master switch, the one key that opens the in-game layer, a
// button to hide everything for now, then the overlays (module pages, always over the game or with a key) grouped by
// game, with "All games" for those made outside a game, and the panels shown in the game. Modules add overlays with
// "Show over game" and panels get "Show in game" in their menu; both are removed here.
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { cn } from "@/lib/utils";
import { hotkeyKeys } from "../../../shared/hotkey-keys";
import type { GameOverlaysView } from "../../../shared/host-api";
import { act, state } from "../../host";
import { t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

type Group = GameOverlaysView["groups"][number];
type Overlay = Group["overlays"][number];

const overlays = computed(() => state.value!.gameOverlays);
const mac = navigator.platform.startsWith("Mac");

const enabled = computed({
  get: () => overlays.value.enabled,
  set: (on: boolean) => void act({ type: "set-game-overlays", enabled: on }),
});

const modes = computed(() => [
  { value: "always" as const, label: t("overlays.mode.always") },
  { value: "toggle" as const, label: t("overlays.mode.toggle") },
]);
const opacities = (["100", "75", "50", "25"] as const).map((value) => ({ value, label: `${value}%` }));

const target = (overlay: Overlay) => ({ owner: overlay.owner, moduleId: overlay.moduleId, gameId: overlay.gameId, key: overlay.key });
const groupName = (group: Group) => group.name ?? t("overlays.allGames");

function change(overlay: Overlay, change: { mode?: "always" | "toggle"; opacity?: 100 | 75 | 50 | 25; hideFromCapture?: boolean }) {
  void act({ type: "set-game-overlay", ...target(overlay), ...change });
}

function remove(overlay: Overlay) {
  void act({ type: "remove-game-overlay", ...target(overlay) });
}

function preview(overlay: Overlay) {
  void act({ type: "preview-overlay", ...target(overlay) });
}

function askKey(overlay?: Overlay) {
  void act({ type: "set-overlay-key", ...(overlay ? target(overlay) : {}) });
}

function stopShowing(instanceId: string) {
  void act({ type: "stop-panel-in-game", instanceId });
}
</script>

<template>
  <SettingGroup :title="t('overlays.group.overlays')">
    <SettingRow :label="t('settings.game-overlays.label')" :description="t('settings.game-overlays.description')" setting="game-overlays" :highlighted="highlight === 'game-overlays'">
      <Switch v-model="enabled" :aria-label="t('settings.game-overlays.label')" data-testid="game-overlays" />
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
    <SettingRow :label="t('settings.overlay-hide-all.label')" :description="t('settings.overlay-hide-all.description')" setting="overlay-hide-all" :highlighted="highlight === 'overlay-hide-all'">
      <Button variant="secondary" data-testid="overlay-hide-all" @click="act({ type: 'set-game-overlays-hidden', hidden: !overlays.hidden })">
        {{ overlays.hidden ? t("overlays.showAgain") : t("overlays.hideAll") }}
      </Button>
    </SettingRow>
  </SettingGroup>

  <SettingGroup :title="t('overlays.group.list')" :description="t('settings.game-overlay-list.description')">
    <div
      :class="cn('-mx-5 px-5 transition-colors duration-500', highlight === 'game-overlay-list' && 'bg-primary/10')"
      data-setting="game-overlay-list"
      :data-highlighted="highlight === 'game-overlay-list' || undefined"
    >
      <p v-if="!overlays.groups.length" class="text-muted-foreground py-4 text-sm" data-testid="game-overlays-empty">{{ t("overlays.none") }}</p>
      <section v-for="group in overlays.groups" :key="group.id" class="border-b py-4 last:border-b-0" :data-testid="`game-overlays-${group.id}`">
        <h4 class="mb-2 font-medium">{{ groupName(group) }}</h4>
        <ul class="mt-2 flex flex-col gap-3">
          <li v-for="overlay in group.overlays" :key="`${overlay.gameId}:${overlay.moduleId}:${overlay.key}`" class="bg-card flex flex-col gap-2 rounded-lg border px-4 py-3" :data-testid="`game-overlay-${overlay.moduleId}-${overlay.key}`">
            <div class="flex items-center gap-3">
              <span class="min-w-0 flex-1 truncate font-medium">{{ overlay.name }}</span>
              <Button variant="secondary" size="sm" :aria-label="t('overlays.previewLabel', { name: overlay.name })" :data-testid="`overlay-preview-${overlay.key}`" @click="preview(overlay)">{{ t("overlays.preview") }}</Button>
              <Button variant="ghost" size="sm" :aria-label="t('overlays.removeLabel', { name: overlay.name, game: groupName(group) })" @click="remove(overlay)">{{ t("overlays.remove") }}</Button>
            </div>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span class="text-muted-foreground w-24 flex-none text-sm">{{ t("overlays.mode.label") }}</span>
              <SegmentedControl :model-value="overlay.mode" :options="modes" :label="t('overlays.mode.label')" @update:model-value="change(overlay, { mode: $event })" />
              <template v-if="overlay.mode === 'toggle'">
                <span v-if="overlay.hotkey" class="flex flex-none items-center gap-1">
                  <Kbd v-for="key in hotkeyKeys(overlay.hotkey.accelerator, mac)" :key="key">{{ key }}</Kbd>
                </span>
                <span v-else class="text-muted-foreground text-xs">{{ t("overlays.key.none") }}</span>
                <span v-if="overlay.hotkey?.taken" class="text-destructive text-xs">{{ t("overlays.key.taken") }}</span>
                <Button variant="secondary" size="sm" :aria-label="t(overlay.hotkey ? 'overlays.key.changeLabel' : 'overlays.key.setLabel', { name: overlay.name })" @click="askKey(overlay)">
                  {{ overlay.hotkey ? t("overlays.key.change") : t("overlays.key.set") }}
                </Button>
              </template>
            </div>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span class="text-muted-foreground w-24 flex-none text-sm">{{ t("overlays.opacity.label") }}</span>
              <SegmentedControl
                :model-value="String(overlay.opacity) as '100' | '75' | '50' | '25'"
                :options="opacities"
                :label="t('overlays.opacity.label')"
                @update:model-value="change(overlay, { opacity: Number($event) as 100 | 75 | 50 | 25 })"
              />
            </div>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span class="text-muted-foreground w-24 flex-none text-sm">{{ t("overlays.capture.label") }}</span>
              <Switch :model-value="overlay.hideFromCapture" :aria-label="t('overlays.capture.label')" @update:model-value="change(overlay, { hideFromCapture: $event })" />
              <span class="text-muted-foreground text-xs">{{ t("overlays.capture.hint") }}</span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </SettingGroup>

  <SettingGroup :title="t('overlays.group.panels')" :description="t('settings.game-panels.description')">
    <div
      :class="cn('-mx-5 px-5 transition-colors duration-500', highlight === 'game-panels' && 'bg-primary/10')"
      data-setting="game-panels"
      :data-highlighted="highlight === 'game-panels' || undefined"
    >
      <p v-if="!overlays.panels.length" class="text-muted-foreground py-4 text-sm" data-testid="game-panels-empty">{{ t("overlays.panels.none") }}</p>
      <ul v-else class="flex flex-col">
        <li v-for="panel in overlays.panels" :key="panel.instanceId" class="flex min-h-12 items-center gap-3 border-b py-2 last:border-b-0" :data-testid="`game-panel-${panel.instanceId}`">
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate font-medium">{{ panel.name }}</span>
            <span class="text-muted-foreground truncate text-xs">{{ panel.gameName ?? t("overlays.allGames") }}</span>
          </span>
          <Button variant="secondary" size="sm" :aria-label="t('overlays.stopShowingNamed', { name: panel.name })" :data-testid="`panel-stop-showing-${panel.instanceId}`" @click="stopShowing(panel.instanceId)">
            {{ t("overlays.stopShowing") }}
          </Button>
        </li>
      </ul>
    </div>
  </SettingGroup>
</template>
