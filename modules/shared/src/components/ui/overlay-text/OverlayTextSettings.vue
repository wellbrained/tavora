<script setup lang="ts">
// The settings of an overlay text's box, as one section of a module's settings page (ModuleSettings): the box grows with the
// text or is fixed, and for a fixed box what a long text does, how fast it scrolls, the pause at the start of each round and
// soft edges. Every text overlay uses it, so they read and work the same. It shows `value` and emits only what was changed
// (`change`), so a module saves just that field and leaves the others as they were saved.
import { computed } from "vue"
import { cn } from "../../../lib/utils"
import { SettingsRow, SettingsSection } from "../module-settings"
import { SegmentedControl } from "../segmented-control"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select"
import { Switch } from "../switch"
import { uiLanguage, uiText } from "../text"
import { OVERLAY_TEXT_BOXES, OVERLAY_TEXT_PAUSES, OVERLAY_TEXT_SPEEDS, OVERLAY_TEXT_TOO_LONG, type OverlayTextBoxSettings } from "./plan"

const props = defineProps<{
  value: OverlayTextBoxSettings
  /** The section's title; the kit's "Box" by default. */
  title?: string
  class?: string
}>()
const emit = defineEmits<{ change: [change: Partial<OverlayTextBoxSettings>] }>()

/** Segments that share the control column evenly. */
const fill = "w-full min-w-0 [&>*]:flex-1 [&>*]:px-0"
const text = computed(() => uiText.value)
const NAMES = { grow: "otGrow", fixed: "otFixed", scroll: "otScroll", shrink: "otShrink", cut: "otCut", slow: "otSlow", normal: "otNormal", fast: "otFast" } as const
const options = <T extends keyof typeof NAMES>(values: readonly T[], testid: string) => values.map((value) => ({ value, label: text.value[NAMES[value]], testid: `${testid}-${value}` }))

const seconds = computed(() => new Intl.NumberFormat(uiLanguage.value === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 1 }))
const pauseLabel = (value: number) => (value === 0 ? text.value.otPauseOff : seconds.value.format(value))

const box = computed({ get: () => props.value.box, set: (box) => emit("change", { box }) })
const tooLong = computed({ get: () => props.value.tooLong, set: (tooLong) => emit("change", { tooLong }) })
const speed = computed({ get: () => props.value.speed, set: (speed) => emit("change", { speed }) })
const pause = computed({ get: () => String(props.value.pause), set: (pause: string) => emit("change", { pause: Number(pause) }) })
</script>

<template>
  <SettingsSection :title="title ?? text.otBox" :class="cn(props.class)" data-overlay-text-settings>
    <SettingsRow :label="text.otSize" :hint="value.box === 'grow' ? text.otGrowHint : text.otFixedHint">
      <SegmentedControl v-model="box" :label="text.otSize" :options="options(OVERLAY_TEXT_BOXES, 'box')" :class="fill" />
    </SettingsRow>
    <template v-if="value.box === 'fixed'">
      <SettingsRow :label="text.otTooLong" :hint="text.otTooLongHint">
        <SegmentedControl v-model="tooLong" :label="text.otTooLong" :options="options(OVERLAY_TEXT_TOO_LONG, 'too-long')" :class="fill" />
      </SettingsRow>
      <template v-if="value.tooLong === 'scroll'">
        <SettingsRow :label="text.otSpeed" :hint="text.otSpeedHint">
          <SegmentedControl v-model="speed" :label="text.otSpeed" :options="options(OVERLAY_TEXT_SPEEDS, 'speed')" :class="fill" />
        </SettingsRow>
        <SettingsRow :label="text.otPause" :hint="text.otPauseHint">
          <Select v-model="pause">
            <SelectTrigger class="w-24" :aria-label="text.otPause" data-testid="pause">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="value in OVERLAY_TEXT_PAUSES" :key="value" :value="String(value)" :data-testid="`pause-${value}`">{{ pauseLabel(value) }}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow :label="text.otSoftEdges" :hint="text.otSoftEdgesHint">
          <Switch :model-value="value.softEdges" :aria-label="text.otSoftEdges" data-testid="soft-edges" @update:model-value="(softEdges: boolean) => emit('change', { softEdges })" />
        </SettingsRow>
      </template>
    </template>
  </SettingsSection>
</template>
