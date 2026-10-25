<script setup lang="ts">
// Settings > Streaming: Stream overlays (module pages for OBS, served on this PC only) and the hotkeys set for
// module actions, in every game. Modules ask for overlays with the stream-overlay connector; taking it back here
// takes back everything the module was granted, as in Settings > Modules.
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { cn } from "@/lib/utils";
import { hotkeyKeys } from "../../../shared/hotkey-keys";
import type { HotkeyView } from "../../../shared/host-api";
import { act, confirmAction, gamesUsing, listOf, state, submitAction } from "../../host";
import { t } from "../../i18n";
import ModuleIcon from "../ModuleIcon.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();

type ModuleView = NonNullable<typeof state.value>["modules"][number];

const streaming = computed(() => state.value!.streaming);
const mac = navigator.platform.startsWith("Mac");

const enabled = computed({
  get: () => streaming.value.overlays.enabled,
  set: (on: boolean) => void act({ type: "set-stream-overlays", enabled: on }),
});

const port = ref(String(streaming.value.overlays.port));
watch(
  () => streaming.value.overlays.port,
  (saved) => (port.value = String(saved)),
);
const portNumber = computed(() => Number(port.value));
const portValid = computed(() => /^\d{4,5}$/.test(port.value.trim()) && portNumber.value >= 1024 && portNumber.value <= 65535);

function changePort() {
  if (portValid.value) void act({ type: "set-overlay-port", port: portNumber.value });
}

const status = computed(() => {
  const { status: now, port: at } = streaming.value.overlays;
  if (now === "running") return { text: t("streaming.status.running", { port: String(at) }), problem: false };
  if (now === "in-use") return { text: t("streaming.status.in-use", { port: String(at) }), problem: true };
  if (now === "failed") return { text: t("streaming.status.failed"), problem: true };
  return null;
});

function resetLinks() {
  confirmAction({
    title: t("streaming.links.resetTitle"),
    message: t("streaming.links.resetMessage"),
    confirm: t("streaming.links.reset"),
    danger: true,
    run: () => submitAction({ type: "reset-overlay-links" }),
  });
}

const overlayModules = computed(() => (state.value?.modules ?? []).filter((module) => module.permissions.granted.connectors.includes("stream-overlay")));

function revoke(module: ModuleView) {
  const games = gamesUsing(module);
  confirmAction({
    title: t("integrations.grants.revokeTitle", { name: module.name }),
    message: games.length
      ? t("integrations.grants.revokeUsed", { name: module.name, games: listOf(games) })
      : t("integrations.grants.revokeUnused", { name: module.name }),
    confirm: t("integrations.grants.revoke"),
    danger: true,
    run: () => submitAction({ type: "revoke-module", moduleId: module.id }),
  });
}

/** Hotkeys by game, games in the order of their names. */
const hotkeyGames = computed(() => {
  const games = new Map<string, { name: string; hotkeys: HotkeyView[] }>();
  for (const hotkey of streaming.value.hotkeys) {
    if (!games.has(hotkey.gameId)) games.set(hotkey.gameId, { name: hotkey.gameName, hotkeys: [] });
    games.get(hotkey.gameId)!.hotkeys.push(hotkey);
  }
  return [...games.entries()].map(([id, game]) => ({ id, ...game })).sort((a, b) => a.name.localeCompare(b.name));
});

function removeHotkey(hotkey: HotkeyView) {
  void act({ type: "remove-hotkey", owner: hotkey.owner, moduleId: hotkey.moduleId, gameId: hotkey.gameId, action: hotkey.action, target: hotkey.target });
}
</script>

<template>
  <SettingGroup :title="t('streaming.group.overlays')">
    <SettingRow :label="t('settings.stream-overlays.label')" :description="t('settings.stream-overlays.description')" setting="stream-overlays" :highlighted="highlight === 'stream-overlays'">
      <template #below>
        <span v-if="status" :class="cn('text-sm', status.problem ? 'text-destructive' : 'text-muted-foreground')" data-testid="overlay-status">{{ status.text }}</span>
      </template>
      <Switch v-model="enabled" :aria-label="t('settings.stream-overlays.label')" data-testid="stream-overlays" />
    </SettingRow>
    <SettingRow :label="t('settings.overlay-port.label')" :description="t('settings.overlay-port.description')" setting="overlay-port" :highlighted="highlight === 'overlay-port'">
      <template #below>
        <span v-if="!portValid" class="text-destructive text-sm">{{ t("streaming.port.invalid") }}</span>
      </template>
      <form class="flex items-center gap-2" @submit.prevent="changePort">
        <Input v-model="port" class="w-24 tabular-nums" inputmode="numeric" maxlength="5" :aria-label="t('settings.overlay-port.label')" data-testid="overlay-port" />
        <Button type="submit" variant="secondary" :disabled="!portValid || portNumber === streaming.overlays.port" data-testid="overlay-port-change">{{ t("streaming.port.change") }}</Button>
      </form>
    </SettingRow>
    <SettingRow :label="t('settings.overlay-links.label')" :description="t('settings.overlay-links.description')" setting="overlay-links" :highlighted="highlight === 'overlay-links'">
      <Button variant="secondary" data-testid="overlay-links-reset" @click="resetLinks">{{ t("streaming.links.reset") }}</Button>
    </SettingRow>
  </SettingGroup>

  <SettingGroup :title="t('streaming.modules.title')">
    <p v-if="!overlayModules.length" class="text-muted-foreground py-4 text-sm" data-testid="overlay-modules-empty">{{ t("streaming.modules.none") }}</p>
    <ul v-else class="flex flex-col" data-testid="overlay-modules">
      <li v-for="module in overlayModules" :key="module.id" class="flex items-center gap-3 border-b py-3 last:border-b-0">
        <span class="bg-background text-primary flex size-8 flex-none items-center justify-center rounded-lg border" aria-hidden="true">
          <ModuleIcon :module-id="module.id" size="size-4" />
        </span>
        <span class="min-w-0 flex-1 truncate font-medium">{{ module.name }}</span>
        <Button variant="danger" :aria-label="t('integrations.grants.revokeLabel', { name: module.name })" @click="revoke(module)">{{ t("integrations.grants.revoke") }}</Button>
      </li>
    </ul>
  </SettingGroup>

  <SettingGroup :title="t('streaming.group.hotkeys')" :description="t('settings.hotkeys.description')">
    <div
      :class="cn('-mx-5 px-5 transition-colors duration-500', highlight === 'hotkeys' && 'bg-primary/10')"
      data-setting="hotkeys"
      :data-highlighted="highlight === 'hotkeys' || undefined"
    >
      <p v-if="!hotkeyGames.length" class="text-muted-foreground py-4 text-sm" data-testid="hotkeys-empty">{{ t("streaming.hotkeys.none") }}</p>
      <section v-for="game in hotkeyGames" :key="game.id" class="border-b py-3 last:border-b-0" :data-testid="`hotkeys-${game.id}`">
        <h4 class="text-muted-foreground mb-1 text-sm font-medium">{{ game.name }}</h4>
        <ul class="flex flex-col">
          <li v-for="hotkey in game.hotkeys" :key="`${hotkey.moduleId}:${hotkey.target}:${hotkey.action}`" class="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 py-1">
            <span class="flex min-w-0 flex-1 basis-48 flex-col">
              <span class="truncate">{{ hotkey.label }} · {{ hotkey.actionName }}</span>
              <span class="text-muted-foreground truncate text-xs">{{ hotkey.moduleName }}<template v-if="hotkey.taken"> · <span class="text-destructive">{{ t("streaming.hotkeys.taken") }}</span></template></span>
            </span>
            <span class="flex flex-none items-center gap-1">
              <Kbd v-for="key in hotkeyKeys(hotkey.accelerator, mac)" :key="key">{{ key }}</Kbd>
            </span>
            <Button variant="ghost" size="sm" :aria-label="t('streaming.hotkeys.removeLabel', { label: hotkey.label, action: hotkey.actionName })" @click="removeHotkey(hotkey)">
              {{ t("streaming.hotkeys.remove") }}
            </Button>
          </li>
        </ul>
      </section>
    </div>
  </SettingGroup>
</template>
