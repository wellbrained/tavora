<script setup lang="ts">
// Settings > Overlays & streaming. Over your game (only on PCs that can show it): the master switch and the global
// options (the one key that opens the in-game layer, keep when you switch windows, the sidebar's side). Arranging
// and pausing are in the workspace header's Overlay button; modules add overlays with "Show over game" and panels
// get "Show in game" in their menu. On stream: stream overlays (module pages for OBS, served on this PC only), their
// links and the modules that may show them. Then the hotkeys set for module actions, in every workspace. Lists open
// in place, so the page stays short.
import { computed, reactive, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { cn } from "@/lib/utils";
import { hotkeyKeys } from "../../../shared/hotkey-keys";
import type { HotkeyView } from "../../../shared/host-api";
import { act, confirmAction, state, submitAction } from "../../host";
import { t } from "../../i18n";
import GrantedModules from "./GrantedModules.vue";
import SettingExpand from "./SettingExpand.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

const props = defineProps<{ highlight: string | null }>();

const mac = navigator.platform.startsWith("Mac");

// Over your game.
const overlays = computed(() => state.value!.gameOverlays);
const enabled = computed({
  get: () => overlays.value.enabled,
  set: (on: boolean) => void act({ type: "set-game-overlays", enabled: on }),
});
const stay = computed({
  get: () => overlays.value.stay,
  set: (on: boolean) => void act({ type: "set-overlays-stay", enabled: on }),
});
const sidebar = computed({
  get: () => overlays.value.sidebar,
  set: (side: "left" | "right") => void act({ type: "set-overlay-sidebar", side }),
});
const sidebarOptions = computed(() => [
  { value: "left", label: t("overlays.sidebar.left"), testid: "overlay-sidebar-left" },
  { value: "right", label: t("overlays.sidebar.right"), testid: "overlay-sidebar-right" },
]);

// On stream.
const streaming = computed(() => state.value!.streaming);
const streamOn = computed({
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
function previewLink(link: (typeof streaming.value.links)[number]) {
  void act({ type: "preview-overlay", owner: link.owner, moduleId: link.moduleId, workspaceId: link.workspaceId, key: link.key });
}
const overlayModules = computed(() => (state.value?.modules ?? []).filter((module) => module.permissions.granted.connectors.includes("stream-overlay")).length);

/** Hotkeys by workspace, workspaces in the order of their names. */
const hotkeyWorkspaces = computed(() => {
  const workspaces = new Map<string, { name: string; hotkeys: HotkeyView[] }>();
  for (const hotkey of streaming.value.hotkeys) {
    if (!workspaces.has(hotkey.workspaceId)) workspaces.set(hotkey.workspaceId, { name: hotkey.workspaceName, hotkeys: [] });
    workspaces.get(hotkey.workspaceId)!.hotkeys.push(hotkey);
  }
  return [...workspaces.entries()].map(([id, workspace]) => ({ id, ...workspace })).sort((a, b) => a.name.localeCompare(b.name));
});
function removeHotkey(hotkey: HotkeyView) {
  void act({ type: "remove-hotkey", owner: hotkey.owner, moduleId: hotkey.moduleId, workspaceId: hotkey.workspaceId, action: hotkey.action, target: hotkey.target });
}

/** The lists opened; a search result opens its own. */
const open = reactive<Record<string, boolean>>({});
watch(
  () => props.highlight,
  (setting) => {
    if (setting) open[setting] = true;
  },
  { immediate: true },
);
</script>

<template>
  <SettingGroup v-if="overlays.supported" :title="t('overlays.group.overGame')">
    <SettingRow :label="t('settings.game-overlays.label')" :description="t('settings.game-overlays.description')" setting="game-overlays" :highlighted="highlight === 'game-overlays'">
      <Switch v-model="enabled" :aria-label="t('settings.game-overlays.label')" data-testid="game-overlays" />
    </SettingRow>
    <SettingRow
      :label="t('settings.overlay-layer-key.label')"
      :description="t('settings.overlay-layer-key.description')"
      :details="t('settings.overlay-layer-key.details')"
      setting="overlay-layer-key"
      :highlighted="highlight === 'overlay-layer-key'"
    >
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
          @click="act({ type: 'set-overlay-key' })"
        >
          {{ overlays.layerKey ? t("overlays.key.change") : t("overlays.key.set") }}
        </Button>
      </span>
    </SettingRow>
    <SettingRow
      :label="t('settings.overlays-stay.label')"
      :description="t('settings.overlays-stay.description')"
      :details="t('settings.overlays-stay.details')"
      setting="overlays-stay"
      :highlighted="highlight === 'overlays-stay'"
    >
      <Switch v-model="stay" :disabled="!enabled" :aria-label="t('settings.overlays-stay.label')" data-testid="overlays-stay" />
    </SettingRow>
    <SettingRow :label="t('settings.overlay-sidebar.label')" :description="t('settings.overlay-sidebar.description')" setting="overlay-sidebar" :highlighted="highlight === 'overlay-sidebar'">
      <SegmentedControl v-model="sidebar" :options="sidebarOptions" :label="t('settings.overlay-sidebar.label')" />
    </SettingRow>
  </SettingGroup>

  <SettingGroup :title="t('overlays.group.onStream')">
    <SettingRow
      :label="t('settings.stream-overlays.label')"
      :description="t('settings.stream-overlays.description')"
      :details="t('settings.stream-overlays.details')"
      setting="stream-overlays"
      :highlighted="highlight === 'stream-overlays'"
    >
      <template #below>
        <span v-if="status" :class="cn('text-sm', status.problem ? 'text-destructive' : 'text-success')" data-testid="overlay-status">{{ status.text }}</span>
      </template>
      <Switch v-model="streamOn" :aria-label="t('settings.stream-overlays.label')" data-testid="stream-overlays" />
    </SettingRow>
    <SettingRow
      :label="t('settings.overlay-port.label')"
      :description="t('settings.overlay-port.description')"
      :details="t('settings.overlay-port.details')"
      setting="overlay-port"
      :highlighted="highlight === 'overlay-port'"
    >
      <template #below>
        <span v-if="!portValid" class="text-destructive text-sm">{{ t("streaming.port.invalid") }}</span>
      </template>
      <form class="flex items-center gap-2" @submit.prevent="changePort">
        <Input v-model="port" class="w-24 tabular-nums" inputmode="numeric" maxlength="5" :aria-label="t('settings.overlay-port.label')" data-testid="overlay-port" />
        <Button type="submit" variant="secondary" :disabled="!portValid || portNumber === streaming.overlays.port" data-testid="overlay-port-change">{{ t("streaming.port.change") }}</Button>
      </form>
    </SettingRow>
    <SettingExpand
      v-model:open="open['overlay-links']"
      :label="t('settings.overlay-links.label')"
      :description="streaming.links.length ? t('streaming.links.count', { count: streaming.links.length }) : t('streaming.links.none')"
      :details="t('settings.overlay-links.details')"
      setting="overlay-links"
      :highlighted="highlight === 'overlay-links'"
      testid="overlay-links"
    >
      <ul v-if="streaming.links.length" class="flex flex-col" data-testid="overlay-link-list">
        <li v-for="link in streaming.links" :key="`${link.workspaceId}:${link.moduleId}:${link.key}`" class="flex items-center gap-3 border-b border-dashed py-2 last:border-b-0">
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate font-medium">{{ link.moduleName }} · {{ link.key }}</span>
            <span class="text-muted-foreground truncate text-xs">{{ link.workspaceName }}</span>
          </span>
          <Button variant="secondary" size="sm" :aria-label="t('overlays.previewLabel', { name: link.moduleName })" :data-testid="`link-preview-${link.key}`" @click="previewLink(link)">{{ t("overlays.preview") }}</Button>
        </li>
      </ul>
      <div class="py-2">
        <Button variant="danger" size="sm" data-testid="overlay-links-reset" @click="resetLinks">{{ t("streaming.links.reset") }}</Button>
      </div>
    </SettingExpand>
    <SettingExpand
      v-model:open="open['overlay-modules']"
      :label="t('streaming.modules.title')"
      :description="overlayModules ? t('connections.usedBy', { count: overlayModules }) : t('connections.unused')"
      testid="overlay-modules"
    >
      <GrantedModules uses="stream-overlay" :none="t('streaming.modules.none')" revoke-label="integrations.grants.revokeLabel" revoke-unused="integrations.grants.revokeUnused" testid="overlay-modules" />
    </SettingExpand>
  </SettingGroup>

  <SettingGroup :title="t('streaming.group.hotkeys')">
    <SettingExpand
      v-model:open="open.hotkeys"
      :label="t('settings.hotkeys.label')"
      :description="streaming.hotkeys.length ? t('streaming.hotkeys.count', { count: streaming.hotkeys.length }) : t('streaming.hotkeys.none')"
      :details="t('settings.hotkeys.description')"
      setting="hotkeys"
      :highlighted="highlight === 'hotkeys'"
      testid="hotkeys"
    >
      <p v-if="!hotkeyWorkspaces.length" class="text-muted-foreground py-2 text-sm" data-testid="hotkeys-empty">{{ t("streaming.hotkeys.none") }}</p>
      <section v-for="workspace in hotkeyWorkspaces" :key="workspace.id" class="border-b border-dashed py-2 last:border-b-0" :data-testid="`hotkeys-${workspace.id}`">
        <h4 class="text-muted-foreground mb-1 text-xs font-semibold">{{ workspace.name }}</h4>
        <ul class="flex flex-col">
          <li v-for="hotkey in workspace.hotkeys" :key="`${hotkey.moduleId}:${hotkey.target}:${hotkey.action}`" class="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 py-1">
            <span class="flex min-w-0 flex-1 basis-48 flex-col">
              <span class="truncate">{{ hotkey.label }} · {{ hotkey.actionName }}</span>
              <span class="text-muted-foreground truncate text-xs"
                >{{ hotkey.moduleName }}<template v-if="hotkey.taken"> · <span class="text-destructive">{{ t("streaming.hotkeys.taken") }}</span></template></span
              >
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
    </SettingExpand>
  </SettingGroup>
</template>
