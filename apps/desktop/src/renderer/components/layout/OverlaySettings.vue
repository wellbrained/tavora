<script setup lang="ts">
// The Overlay page's Settings panel: what the user sets for the selected frame itself (when it shows: always or with a
// key, how see-through it is, Hide from capture) and Move to… another setup. What the item is (its name, its look) is the
// module's own, behind the gear; Reset position, Reset size and Remove are on the frame's toolbar. It is sized to its
// content; a short hint shows while nothing is selected. With several frames selected it says how many and has the settings
// that apply to all of them (Show, Opacity, Hide from capture); one that differs between them shows as Mixed. Each change
// goes through the Overlay page, so it is one undo step for all.
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
import type { LayoutItemChange } from "../../../shared/layout-view";
import { act } from "../../host";
import { t } from "../../i18n";
import { send } from "./layout-state";

/** `items`: the selected frames of the setup shown, which this panel changes. */
const props = defineProps<{ items: LayoutItemView[]; setupName: string }>();
const mac = navigator.platform.startsWith("Mac");

/** The one frame selected, for what only one can have (its key, Move to…); null with none or several. */
const item = computed(() => (props.items.length === 1 ? props.items[0]! : null));
const many = computed(() => props.items.length > 1);

function change(next: LayoutItemChange) {
  if (props.items.length) send({ type: "set", ids: props.items.map((one) => one.id), change: next });
}

function askKey() {
  if (item.value) void act({ type: "set-overlay-key", ...item.value.keyTarget });
}

/** The value all selected frames share, or null when they differ (Mixed). */
function shared<T>(pick: (one: LayoutItemView) => T): T | null {
  const values = new Set(props.items.map(pick));
  return values.size === 1 ? [...values][0]! : null;
}

const MIXED = "";
const modes = computed(() => [
  { value: "always" as const, label: t("overlays.mode.always") },
  { value: "toggle" as const, label: t("overlays.mode.toggle") },
]);
const mode = computed(() => shared((one) => one.mode));
const capture = computed(() => shared((one) => one.hideFromCapture));
const opacity = computed({
  get: () => {
    const value = shared((one) => one.opacity);
    return value === null ? MIXED : String(value);
  },
  set: (value: string) => {
    if (value !== MIXED) change({ opacity: Number(value) as 100 | 75 | 50 | 25 });
  },
});
</script>

<template>
  <section class="bg-card flex flex-none flex-col rounded-lg border" :aria-label="t('overlays.layout.settings')" data-testid="layout-settings">
    <div class="flex items-baseline justify-between gap-3 px-3 pt-3">
      <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ t("overlays.layout.settings") }}</h2>
      <p v-if="item" class="min-w-0 truncate text-sm font-medium" data-testid="layout-selected">{{ item.name }}</p>
      <p v-else-if="many" class="min-w-0 truncate text-sm font-medium" data-testid="layout-selected-count">{{ t("overlays.layout.selectedCount", { count: items.length }) }}</p>
    </div>
    <p v-if="!items.length" class="text-muted-foreground px-3 py-3 text-sm" data-testid="layout-pick">{{ t("overlays.layout.pick") }}</p>
    <div v-else class="flex flex-col gap-3 px-3 py-3" :data-testid="item ? `layout-row-${item.id}` : 'layout-row-many'">
      <div class="flex flex-col gap-1.5">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span class="text-muted-foreground w-28 flex-none text-sm">{{ t("overlays.mode.label") }}</span>
          <!-- Mixed: no choice is shown as picked until one is. -->
          <SegmentedControl :model-value="mode ?? (MIXED as 'always')" :options="modes" :label="t('overlays.mode.label')" @update:model-value="change({ mode: $event })" />
          <span v-if="mode === null" class="text-muted-foreground text-xs" data-testid="layout-mode-mixed">{{ t("overlays.layout.mixed") }}</span>
        </div>
        <p v-if="mode !== null" class="text-muted-foreground text-xs" data-testid="layout-mode-hint">{{ t(mode === "toggle" ? "overlays.mode.toggleHint" : "overlays.mode.alwaysHint") }}</p>
      </div>
      <div v-if="item && item.mode === 'toggle'" class="flex flex-wrap items-center gap-x-3 gap-y-2">
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
          <SelectTrigger size="sm" class="w-28" :aria-label="t('overlays.opacity.label')" :data-testid="item ? `layout-opacity-${item.id}` : 'layout-opacity-many'">
            <SelectValue :placeholder="t('overlays.layout.mixed')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="value in ['100', '75', '50', '25']" :key="value" :value="value">{{ value }}%</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex flex-col gap-1.5">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="text-muted-foreground w-28 flex-none text-sm">{{ t("overlays.capture.label") }}</span>
          <Switch :model-value="capture === true" :aria-label="t('overlays.capture.label')" data-testid="layout-capture" @update:model-value="change({ hideFromCapture: $event })" />
          <span v-if="capture === null" class="text-muted-foreground text-xs" data-testid="layout-capture-mixed">{{ t("overlays.layout.mixed") }}</span>
        </div>
        <p class="text-muted-foreground text-xs">{{ t("overlays.capture.hint") }}</p>
      </div>
      <div v-if="item && item.moveTargets.length" class="border-t pt-3">
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
