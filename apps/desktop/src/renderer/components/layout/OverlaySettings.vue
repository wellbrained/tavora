<script setup lang="ts">
// The Overlay page's Settings panel: everything the user sets for the selected item (when it shows: always or with a
// key, how see-through it is, Hide from capture), plus Reset position, Reset size, Preview, Move and Remove. It is
// sized to its content; a short hint shows while nothing is selected.
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { cn } from "@/lib/utils";
import { hotkeyKeys } from "../../../shared/hotkey-keys";
import type { LayoutItemView } from "../../../shared/layout-view";
import { act } from "../../host";
import { t } from "../../i18n";
import { send } from "./layout-state";

/** `setup`: the overlay setup shown, whose item this panel changes. */
const props = defineProps<{ item: LayoutItemView | null; setup: string; setupName: string }>();
const mac = navigator.platform.startsWith("Mac");

type Change = { mode?: "always" | "toggle"; opacity?: 100 | 75 | 50 | 25; hideFromCapture?: boolean };

function change(next: Change) {
  const item = props.item;
  if (!item) return;
  const target = item.target;
  const setup = props.setup;
  void act(target.kind === "panel" ? { type: "set-panel-view", setup, instanceId: target.instanceId, ...next } : { type: "set-game-overlay", setup, owner: target.owner, moduleId: target.moduleId, workspaceId: target.workspaceId, key: target.key, ...next });
}

function remove() {
  const item = props.item;
  if (!item) return;
  const target = item.target;
  const setup = props.setup;
  void act(target.kind === "panel" ? { type: "stop-panel-in-game", setup, instanceId: target.instanceId } : { type: "remove-game-overlay", setup, owner: target.owner, moduleId: target.moduleId, workspaceId: target.workspaceId, key: target.key });
}

function askKey() {
  if (props.item) void act({ type: "set-overlay-key", ...props.item.keyTarget });
}

function preview() {
  const target = props.item?.target;
  if (target?.kind === "overlay") void act({ type: "preview-overlay", owner: target.owner, moduleId: target.moduleId, workspaceId: target.workspaceId, key: target.key });
}

const modes = computed(() => [
  { value: "always" as const, label: t("overlays.mode.always") },
  { value: "toggle" as const, label: t("overlays.mode.toggle") },
]);
const opacity = computed({
  get: () => String(props.item?.opacity ?? 100),
  set: (value: string) => change({ opacity: Number(value) as 100 | 75 | 50 | 25 }),
});
const removeLabel = computed(() => {
  const item = props.item;
  if (!item) return "";
  return item.kind === "panel" ? t("overlays.stopShowingNamed", { name: item.name }) : t("overlays.removeLabel", { name: item.name, game: props.setupName });
});
// Preview and Move sit side by side; one alone takes the whole row.
const wide = computed(() => ((props.item?.kind === "overlay" && props.item.live ? 1 : 0) + (props.item?.moveTo ? 1 : 0) === 1 ? "col-span-2" : ""));
const moveLabel = computed(() => (props.item?.moveTo === "$everywhere" ? t("overlays.layout.moveEverywhere") : t("overlays.layout.moveAll")));
</script>

<template>
  <section class="bg-card flex flex-none flex-col rounded-lg border" :aria-label="t('overlays.layout.settings')" data-testid="layout-settings">
    <div class="flex items-baseline justify-between gap-3 px-3 pt-3">
      <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ t("overlays.layout.settings") }}</h2>
      <p v-if="item" class="min-w-0 truncate text-sm font-medium" data-testid="layout-selected">{{ item.name }}</p>
    </div>
    <p v-if="!item" class="text-muted-foreground px-3 py-3 text-sm" data-testid="layout-pick">{{ t("overlays.layout.pick") }}</p>
    <div v-else class="flex flex-col gap-3 px-3 py-3" :data-testid="`layout-row-${item.id}`">
      <div class="flex flex-col gap-1.5">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span class="text-muted-foreground w-28 flex-none text-sm">{{ t("overlays.mode.label") }}</span>
          <SegmentedControl :model-value="item.mode" :options="modes" :label="t('overlays.mode.label')" @update:model-value="change({ mode: $event })" />
        </div>
        <p class="text-muted-foreground text-xs" data-testid="layout-mode-hint">{{ t(item.mode === "toggle" ? "overlays.mode.toggleHint" : "overlays.mode.alwaysHint") }}</p>
      </div>
      <div v-if="item.mode === 'toggle'" class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span class="text-muted-foreground w-28 flex-none text-sm">{{ t("overlays.key.label") }}</span>
        <span v-if="item.hotkey" class="flex flex-none items-center gap-1">
          <Kbd v-for="key in hotkeyKeys(item.hotkey.accelerator, mac)" :key="key">{{ key }}</Kbd>
        </span>
        <span v-else class="text-muted-foreground text-xs">{{ t("overlays.key.none") }}</span>
        <span v-if="item.hotkey?.taken" class="text-destructive text-xs">{{ t("overlays.key.taken") }}</span>
        <Button variant="secondary" size="sm" :aria-label="t(item.hotkey ? 'overlays.key.changeLabel' : 'overlays.key.setLabel', { name: item.name })" @click="askKey">
          {{ item.hotkey ? t("overlays.key.change") : t("overlays.key.set") }}
        </Button>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span class="text-muted-foreground w-28 flex-none text-sm">{{ t("overlays.opacity.label") }}</span>
        <Select v-model="opacity">
          <SelectTrigger size="sm" class="w-24" :aria-label="t('overlays.opacity.label')" :data-testid="`layout-opacity-${item.id}`">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="value in ['100', '75', '50', '25']" :key="value" :value="value">{{ value }}%</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex flex-col gap-1.5">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="text-muted-foreground w-28 flex-none text-sm">{{ t("overlays.capture.label") }}</span>
          <Switch :model-value="item.hideFromCapture" :aria-label="t('overlays.capture.label')" @update:model-value="change({ hideFromCapture: $event })" />
        </div>
        <p class="text-muted-foreground text-xs">{{ t("overlays.capture.hint") }}</p>
      </div>
      <div class="grid grid-cols-2 gap-2 border-t pt-3">
        <Button variant="secondary" size="sm" class="w-full" :data-testid="`layout-reset-${item.id}`" @click="send({ type: 'reset', id: item.id })">{{ t("overlays.layout.reset") }}</Button>
        <Button variant="secondary" size="sm" class="w-full" :data-testid="`layout-reset-size-${item.id}`" @click="send({ type: 'reset-size', id: item.id })">{{ t("overlays.layout.resetSize") }}</Button>
        <Button v-if="item.kind === 'overlay' && item.live" variant="secondary" size="sm" :class="cn('w-full', wide)" :aria-label="t('overlays.previewLabel', { name: item.name })" @click="preview">{{ t("overlays.layout.preview") }}</Button>
        <Button v-if="item.moveTo" variant="secondary" size="sm" :class="cn('w-full', wide)" :data-testid="`layout-move-${item.id}`" @click="send({ type: 'move', id: item.id })">{{ moveLabel }}</Button>
        <Button variant="danger" size="sm" class="col-span-2 w-full" :aria-label="removeLabel" :data-testid="`layout-remove-${item.id}`" @click="remove">
          {{ item.kind === "panel" ? t("overlays.stopShowing") : t("overlays.remove") }}
        </Button>
      </div>
    </div>
  </section>
</template>
