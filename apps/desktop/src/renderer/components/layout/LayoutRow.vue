<script setup lang="ts">
// One row of the Overlay layout's list (like a source in OBS): the name, the eye that hides it on the canvas only, and,
// for the selected one, everything the player sets: when it shows (always, or with a key), how see-through it is, Hide
// from capture, Reset position, Reset size, Preview and Remove. Selecting a row selects the item on the canvas, and the other way round.
import { Eye, EyeOff, X } from "@lucide/vue";
import { computed } from "vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
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
import ModuleIcon from "../ModuleIcon.vue";
import { send } from "./layout-state";

const props = defineProps<{ item: LayoutItemView; selected: boolean; gameName: string; perGame: boolean }>();
const mac = navigator.platform.startsWith("Mac");

type Change = { mode?: "always" | "toggle"; opacity?: 100 | 75 | 50 | 25; hideFromCapture?: boolean };

function change(next: Change) {
  const target = props.item.target;
  void act(target.kind === "panel" ? { type: "set-panel-view", instanceId: target.instanceId, ...next } : { type: "set-game-overlay", owner: target.owner, moduleId: target.moduleId, gameId: target.gameId, key: target.key, ...next });
}

function remove() {
  const target = props.item.target;
  void act(target.kind === "panel" ? { type: "stop-panel-in-game", instanceId: target.instanceId } : { type: "remove-game-overlay", owner: target.owner, moduleId: target.moduleId, gameId: target.gameId, key: target.key });
}

function askKey() {
  void act({ type: "set-overlay-key", ...props.item.keyTarget });
}

function preview() {
  const target = props.item.target;
  if (target.kind === "overlay") void act({ type: "preview-overlay", owner: target.owner, moduleId: target.moduleId, gameId: target.gameId, key: target.key });
}

const modes = computed(() => [
  { value: "always" as const, label: t("overlays.mode.always") },
  { value: "toggle" as const, label: t("overlays.mode.toggle") },
]);
const opacity = computed({
  get: () => String(props.item.opacity),
  set: (value: string) => change({ opacity: Number(value) as 100 | 75 | 50 | 25 }),
});
const removeLabel = computed(() => (props.item.kind === "panel" ? t("overlays.stopShowingNamed", { name: props.item.name }) : t("overlays.removeLabel", { name: props.item.name, game: props.item.general ? t("overlays.allGames") : props.gameName })));
</script>

<template>
  <li :class="cn('rounded-lg border', selected ? 'border-primary bg-primary/5' : 'bg-card hover:border-input')" :data-testid="`layout-row-${item.id}`">
    <div class="flex items-center gap-2 px-2 py-1.5">
      <button type="button" class="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left outline-none focus-visible:ring-2" :aria-pressed="selected" @click="send({ type: 'select', id: selected ? null : item.id })">
        <ModuleIcon :module-id="item.moduleId" />
        <span :class="cn('min-w-0 flex-1 truncate text-sm font-medium', item.hiddenOnCanvas && 'text-muted-foreground')">{{ item.name }}</span>
        <Badge v-if="item.general" variant="outline">{{ t("overlays.allGames") }}</Badge>
        <Badge v-else-if="item.kind === 'panel'" variant="secondary">{{ t("overlays.layout.panel") }}</Badge>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="item.hiddenOnCanvas ? t('overlays.layout.showOnCanvas') : t('overlays.layout.hideOnCanvas')"
        :title="item.hiddenOnCanvas ? t('overlays.layout.showOnCanvas') : t('overlays.layout.hideOnCanvas')"
        :data-testid="`layout-eye-${item.id}`"
        @click="send({ type: 'canvas-hidden', id: item.id, hidden: !item.hiddenOnCanvas })"
      >
        <EyeOff v-if="item.hiddenOnCanvas" :stroke-width="1.5" />
        <Eye v-else :stroke-width="1.5" />
      </Button>
    </div>
    <div v-if="selected" class="flex flex-col gap-3 border-t px-3 py-3">
      <div v-if="item.general && perGame" class="flex flex-wrap items-center gap-2">
        <span class="text-muted-foreground text-xs">{{ item.ownPosition ? t('overlays.layout.ownPlace', { game: gameName }) : t('overlays.layout.followsAll') }}</span>
        <Button v-if="item.ownPosition" variant="secondary" size="sm" :data-testid="`layout-follow-${item.id}`" @click="send({ type: 'follow-item', id: item.id })">{{ t('overlays.layout.followAgain') }}</Button>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span class="text-muted-foreground w-20 flex-none text-sm">{{ t("overlays.mode.label") }}</span>
        <SegmentedControl :model-value="item.mode" :options="modes" :label="t('overlays.mode.label')" @update:model-value="change({ mode: $event })" />
      </div>
      <div v-if="item.mode === 'toggle'" class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span class="w-20 flex-none" />
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
        <span class="text-muted-foreground w-20 flex-none text-sm">{{ t("overlays.opacity.label") }}</span>
        <Select v-model="opacity">
          <SelectTrigger size="sm" class="w-24" :aria-label="t('overlays.opacity.label')" :data-testid="`layout-opacity-${item.id}`">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="value in ['100', '75', '50', '25']" :key="value" :value="value">{{ value }}%</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="text-muted-foreground w-20 flex-none text-sm">{{ t("overlays.capture.label") }}</span>
        <Switch :model-value="item.hideFromCapture" :aria-label="t('overlays.capture.label')" @update:model-value="change({ hideFromCapture: $event })" />
        <span class="text-muted-foreground min-w-0 flex-1 text-xs">{{ t("overlays.capture.hint") }}</span>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 border-t pt-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" :data-testid="`layout-reset-${item.id}`" @click="send({ type: 'reset', id: item.id })">{{ t("overlays.layout.reset") }}</Button>
          <Button variant="secondary" size="sm" :data-testid="`layout-reset-size-${item.id}`" @click="send({ type: 'reset-size', id: item.id })">{{ t("overlays.layout.resetSize") }}</Button>
          <Button v-if="item.kind === 'overlay' && item.live" variant="secondary" size="sm" :aria-label="t('overlays.previewLabel', { name: item.name })" @click="preview">{{ t("overlays.layout.preview") }}</Button>
        </div>
        <Button variant="ghost" size="sm" class="text-destructive hover:bg-destructive/10 hover:text-destructive ml-auto" :aria-label="removeLabel" :data-testid="`layout-remove-${item.id}`" @click="remove">
          <X :stroke-width="1.5" />{{ item.kind === "panel" ? t("overlays.stopShowing") : t("overlays.remove") }}
        </Button>
      </div>
    </div>
  </li>
</template>
