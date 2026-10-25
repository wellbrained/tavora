<script setup lang="ts">
// Settings > Overlays: Game overlays, module overlay pages Tavora shows over a game while it is in front. The master
// switch, then for each game its arrange key and its overlays: when each shows, its key, how see-through it is and
// whether stream capture may see it. Modules add overlays with "Show over game"; they are removed here.
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { cn } from "@/lib/utils";
import { hotkeyKeys } from "../../../shared/hotkey-keys";
import type { GameOverlaysView, OverlayKeyView } from "../../../shared/host-api";
import { act, state } from "../../host";
import { t } from "../../i18n";
import SegmentedControl from "./SegmentedControl.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

type Game = GameOverlaysView["games"][number];
type Overlay = Game["overlays"][number];

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

const target = (overlay: Overlay, game: Game) => ({ owner: overlay.owner, moduleId: overlay.moduleId, gameId: game.id, key: overlay.key });

function change(game: Game, overlay: Overlay, change: { mode?: "always" | "toggle"; opacity?: 100 | 75 | 50 | 25; showOnStream?: boolean }) {
  void act({ type: "set-game-overlay", ...target(overlay, game), ...change });
}

function remove(game: Game, overlay: Overlay) {
  void act({ type: "remove-game-overlay", ...target(overlay, game) });
}

function askKey(game: Game, overlay?: Overlay) {
  void act({ type: "set-overlay-key", gameId: game.id, ...(overlay ? { owner: overlay.owner, moduleId: overlay.moduleId, key: overlay.key } : {}) });
}
</script>

<template>
  <SettingGroup :title="t('overlays.group.overlays')">
    <SettingRow :label="t('settings.game-overlays.label')" :description="t('settings.game-overlays.description')" setting="game-overlays" :highlighted="highlight === 'game-overlays'">
      <Switch v-model="enabled" :aria-label="t('settings.game-overlays.label')" data-testid="game-overlays" />
    </SettingRow>
  </SettingGroup>

  <SettingGroup :title="t('overlays.group.list')" :description="t('settings.game-overlay-list.description')">
    <div
      :class="cn('-mx-5 px-5 transition-colors duration-500', highlight === 'game-overlay-list' && 'bg-primary/10')"
      data-setting="game-overlay-list"
      :data-highlighted="highlight === 'game-overlay-list' || undefined"
    >
      <p v-if="!overlays.games.length" class="text-muted-foreground py-4 text-sm" data-testid="game-overlays-empty">{{ t("overlays.none") }}</p>
      <section v-for="game in overlays.games" :key="game.id" class="border-b py-4 last:border-b-0" :data-testid="`game-overlays-${game.id}`">
        <h4 class="mb-2 font-medium">{{ game.name }}</h4>

        <div class="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 py-1">
          <span class="flex min-w-0 flex-1 basis-56 flex-col">
            <span class="text-sm">{{ t("overlays.arrange.label") }}</span>
            <span class="text-muted-foreground text-xs">{{ t("overlays.arrange.description") }}</span>
            <span v-if="game.arrange?.taken" class="text-destructive text-xs">{{ t("overlays.key.taken") }}</span>
          </span>
          <span v-if="game.arrange" class="flex flex-none items-center gap-1">
            <kbd v-for="key in hotkeyKeys((game.arrange as OverlayKeyView).accelerator, mac)" :key="key" class="bg-secondary text-foreground min-w-7 rounded-sm border border-b-2 px-1.5 py-0.5 text-center font-mono text-xs">{{ key }}</kbd>
          </span>
          <Button
            variant="secondary"
            size="sm"
            :aria-label="t(game.arrange ? 'overlays.key.changeLabel' : 'overlays.key.setLabel', { name: t('overlays.arrange.label') })"
            :data-testid="`overlay-arrange-${game.id}`"
            @click="askKey(game)"
          >
            {{ game.arrange ? t("overlays.key.change") : t("overlays.key.set") }}
          </Button>
        </div>

        <ul class="mt-2 flex flex-col gap-3">
          <li v-for="overlay in game.overlays" :key="`${overlay.moduleId}:${overlay.key}`" class="bg-card flex flex-col gap-2 rounded-lg border px-4 py-3" :data-testid="`game-overlay-${overlay.moduleId}-${overlay.key}`">
            <div class="flex items-center gap-3">
              <span class="min-w-0 flex-1 truncate font-medium">{{ overlay.name }}</span>
              <Button variant="ghost" size="sm" :aria-label="t('overlays.removeLabel', { name: overlay.name, game: game.name })" @click="remove(game, overlay)">{{ t("overlays.remove") }}</Button>
            </div>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span class="text-muted-foreground w-24 flex-none text-sm">{{ t("overlays.mode.label") }}</span>
              <SegmentedControl :model-value="overlay.mode" :options="modes" :label="t('overlays.mode.label')" @update:model-value="change(game, overlay, { mode: $event })" />
              <template v-if="overlay.mode === 'toggle'">
                <span v-if="overlay.hotkey" class="flex flex-none items-center gap-1">
                  <kbd v-for="key in hotkeyKeys(overlay.hotkey.accelerator, mac)" :key="key" class="bg-secondary text-foreground min-w-7 rounded-sm border border-b-2 px-1.5 py-0.5 text-center font-mono text-xs">{{ key }}</kbd>
                </span>
                <span v-else class="text-muted-foreground text-xs">{{ t("overlays.key.none") }}</span>
                <span v-if="overlay.hotkey?.taken" class="text-destructive text-xs">{{ t("overlays.key.taken") }}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  :aria-label="t(overlay.hotkey ? 'overlays.key.changeLabel' : 'overlays.key.setLabel', { name: overlay.name })"
                  @click="askKey(game, overlay)"
                >
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
                @update:model-value="change(game, overlay, { opacity: Number($event) as 100 | 75 | 50 | 25 })"
              />
            </div>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span class="text-muted-foreground w-24 flex-none text-sm">{{ t("overlays.stream.label") }}</span>
              <Switch :model-value="overlay.showOnStream" :aria-label="t('overlays.stream.label')" @update:model-value="change(game, overlay, { showOnStream: $event })" />
            </div>
          </li>
        </ul>
      </section>
    </div>
  </SettingGroup>
</template>
