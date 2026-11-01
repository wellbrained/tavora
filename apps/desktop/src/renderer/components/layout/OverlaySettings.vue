<script setup lang="ts">
// The Overlay page's Settings panel: what the user sets for the selected frame itself (when it shows: always or with a
// key, how see-through it is, Hide from capture) and Move to… another setup. What the item is (its name, its look) is the
// module's own, behind the gear; Reset position, Reset size and Remove are on the frame's toolbar. It is sized to its
// content; a short hint shows while nothing is selected. With several frames selected it shows what applies to all of
// them (Show, Opacity, Hide from capture), a setting they don't share as mixed; a change sets it on all, as one undo step.
import { computed } from "vue";
import { ChevronDown } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { hotkeyKeys } from "../../../shared/hotkey-keys";
import type { LayoutItemView, LayoutSettingsChange } from "../../../shared/layout-view";
import { act } from "../../host";
import { t } from "../../i18n";
import { send } from "./layout-state";

/** `items`: the frames selected in the setup shown (none, one or several). */
const props = defineProps<{ items: LayoutItemView[] }>();
const mac = navigator.platform.startsWith("Mac");

/** The one frame selected, with everything it has; null with none or several. */
const item = computed(() => (props.items.length === 1 ? props.items[0]! : null));
const many = computed(() => props.items.length > 1);

/** The value all selected share, or undefined when they differ (shown as mixed). */
function shared<K extends "mode" | "opacity" | "hideFromCapture">(key: K): LayoutItemView[K] | undefined {
  const first = props.items[0]?.[key];
  return props.items.every((one) => one[key] === first) ? first : undefined;
}
const mode = computed(() => shared("mode"));
const capture = computed(() => shared("hideFromCapture"));

/** Goes through the Overlay page, so it can be undone, for every frame selected at once. */
function change(next: LayoutSettingsChange) {
  if (props.items.length) send({ type: "change", ids: props.items.map((one) => one.id), change: next });
}

function askKey() {
  if (item.value) void act({ type: "set-overlay-key", ...item.value.keyTarget });
}

const modes = computed(() => [
  { value: "always" as const, label: t("overlays.mode.always") },
  { value: "toggle" as const, label: t("overlays.mode.toggle") },
]);
const opacity = computed({
  // Mixed: no value, so the field shows "Mixed".
  get: () => {
    const value = shared("opacity");
    return value === undefined ? undefined : String(value);
  },
  set: (value: string | undefined) => {
    if (value) change({ opacity: Number(value) as 100 | 75 | 50 | 25 });
  },
});
</script>

<template>
  <section class="bg-card flex flex-none flex-col rounded-lg border" :aria-label="t('overlays.layout.settings')" data-testid="layout-settings">
    <div class="flex items-baseline justify-between gap-3 px-3 pt-3">
      <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ t("overlays.layout.settings") }}</h2>
      <p v-if="item" class="min-w-0 truncate text-sm font-medium" data-testid="layout-selected">{{ item.name }}</p>
      <p v-else-if="many" class="min-w-0 truncate text-sm font-medium" data-testid="layout-selected-many">{{ t("overlays.layout.selectedMany", { count: items.length }) }}</p>
    </div>
    <p v-if="!items.length" class="text-muted-foreground px-3 py-3 text-sm" data-testid="layout-pick">{{ t("overlays.layout.pick") }}</p>
    <div v-else class="flex flex-col gap-3 px-3 py-3" :data-testid="item ? `layout-row-${item.id}` : 'layout-row-many'">
      <div class="flex flex-col gap-1.5">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span class="text-muted-foreground w-28 flex-none text-sm">{{ t("overlays.mode.label") }}</span>
          <!-- Mixed: no choice is marked until one is picked for all. -->
          <SegmentedControl :model-value="mode ?? ('' as 'always')" :options="modes" :label="t('overlays.mode.label')" @update:model-value="change({ mode: $event })" />
          <Badge v-if="!mode" variant="outline" data-testid="layout-mixed-mode">{{ t("overlays.layout.mixed") }}</Badge>
        </div>
        <p v-if="mode" class="text-muted-foreground text-xs" data-testid="layout-mode-hint">{{ t(mode === "toggle" ? "overlays.mode.toggleHint" : "overlays.mode.alwaysHint") }}</p>
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
          <Switch :model-value="capture ?? false" :aria-label="t('overlays.capture.label')" data-testid="layout-capture" @update:model-value="change({ hideFromCapture: $event })" />
          <Badge v-if="capture === undefined" variant="outline" data-testid="layout-mixed-capture">{{ t("overlays.layout.mixed") }}</Badge>
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
