<script setup lang="ts">
// The Overlay page's Settings panel: what the user sets for the selected frame itself (when it shows: always or with a
// key, how see-through it is, Hide from capture) and Move to… another setup. What the item is (its name, its look) is the
// module's own, behind the gear; Reset position, Reset size and Remove are on the frame's toolbar. It is sized to its
// content; a short hint shows while nothing is selected.
import { computed } from "vue";
import { ChevronDown } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Switch } from "@tavora/official-ui/components/ui/switch";
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

function askKey() {
  if (props.item) void act({ type: "set-overlay-key", ...props.item.keyTarget });
}

const modes = computed(() => [
  { value: "always" as const, label: t("overlays.mode.always") },
  { value: "toggle" as const, label: t("overlays.mode.toggle") },
]);
const opacity = computed({
  get: () => String(props.item?.opacity ?? 100),
  set: (value: string) => change({ opacity: Number(value) as 100 | 75 | 50 | 25 }),
});
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
      <div v-if="item.moveTargets.length" class="border-t pt-3">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="secondary" size="sm" class="w-full justify-between" :data-testid="`layout-move-${item.id}`">
              {{ t("overlays.layout.moveTo") }}
              <ChevronDown :stroke-width="1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="min-w-48">
            <DropdownMenuItem v-for="target in item.moveTargets" :key="target.id" :data-testid="`layout-move-to-${target.id}`" @select="send({ type: 'move', id: item.id, to: target.id })">{{ target.name }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  </section>
</template>
