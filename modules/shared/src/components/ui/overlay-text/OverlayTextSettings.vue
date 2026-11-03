<script setup lang="ts">
// The settings of an overlay text, as rows for a module's settings (put them in a SettingsSection on its Look page): grows
// with the text or a fixed size, and for a fixed box what a text too long does, how fast it scrolls, the pause before each
// round and the soft edges. Rows that don't apply to the choice above them are left out.
import { computed } from "vue";
import { SettingsRow } from "../module-settings";
import SegmentedControl from "../segmented-control/SegmentedControl.vue";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../select";
import { Switch } from "../switch";
import { uiText } from "../text";
import { OVERLAY_TEXT_PAUSES, type OverlayTextMode, type OverlayTextOverflow, type OverlayTextSettings, type OverlayTextSpeed } from "./plan";

const settings = defineModel<OverlayTextSettings>({ required: true });
const props = defineProps<{ /** The language's locale, for the pauses' numbers. */ locale?: string; /** Prefix for the controls' test ids. */ testid?: string }>();

// Each choice takes an equal share of the row, as the other settings rows do.
const fill = "w-full min-w-0 [&>*]:flex-1 [&>*]:px-0";
const change = (patch: Partial<OverlayTextSettings>) => (settings.value = { ...settings.value, ...patch });
const id = (name: string) => (props.testid ? `${props.testid}-${name}` : undefined);

const mode = computed({ get: () => settings.value.mode, set: (mode: OverlayTextMode) => change({ mode }) });
const overflow = computed({ get: () => settings.value.overflow, set: (overflow: OverlayTextOverflow) => change({ overflow }) });
const speed = computed({ get: () => settings.value.speed, set: (speed: OverlayTextSpeed) => change({ speed }) });
// Select works on strings; the pause is a number of seconds.
const pause = computed({ get: () => String(settings.value.pause), set: (value: string) => change({ pause: Number(value) }) });
const pauseLabel = (seconds: number) => (seconds === 0 ? uiText.value.textPauseOff : seconds.toLocaleString(props.locale ?? "en-GB"));
</script>

<template>
  <SettingsRow :label="uiText.textBox" :hint="uiText.textBoxHint" stacked>
    <SegmentedControl
      v-model="mode"
      :class="fill"
      :label="uiText.textBox"
      :options="[
        { value: 'grow', label: uiText.textBoxGrow, testid: id('grow') },
        { value: 'fixed', label: uiText.textBoxFixed, testid: id('fixed') },
      ]"
    />
  </SettingsRow>
  <template v-if="settings.mode === 'fixed'">
    <!-- Stacked: three choices with longer words (German) need more room than the control column. -->
    <SettingsRow :label="uiText.textTooLong" :hint="uiText.textTooLongHint" stacked>
      <SegmentedControl
        v-model="overflow"
        :class="fill"
        :label="uiText.textTooLong"
        :options="[
          { value: 'scroll', label: uiText.textScroll, testid: id('scroll') },
          { value: 'shrink', label: uiText.textShrink, testid: id('shrink') },
          { value: 'clip', label: uiText.textClip, testid: id('clip') },
        ]"
      />
    </SettingsRow>
    <template v-if="settings.overflow === 'scroll'">
      <SettingsRow :label="uiText.textSpeed" :hint="uiText.textSpeedHint">
        <SegmentedControl
          v-model="speed"
          :class="fill"
          :label="uiText.textSpeed"
          :options="[
            { value: 'slow', label: uiText.textSlow, testid: id('slow') },
            { value: 'normal', label: uiText.textNormal, testid: id('normal') },
            { value: 'fast', label: uiText.textFast, testid: id('fast') },
          ]"
        />
      </SettingsRow>
      <SettingsRow :label="uiText.textPause" :hint="uiText.textPauseHint">
        <Select v-model="pause">
          <SelectTrigger class="w-24" :aria-label="uiText.textPause" :data-testid="id('pause')">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="seconds in OVERLAY_TEXT_PAUSES" :key="seconds" :value="String(seconds)" :data-testid="id(`pause-${seconds}`)">{{ pauseLabel(seconds) }}</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow :label="uiText.textSoftEdges" :hint="uiText.textSoftEdgesHint">
        <Switch :model-value="settings.softEdges" :aria-label="uiText.textSoftEdges" :data-testid="id('soft-edges')" @update:model-value="(on: boolean) => change({ softEdges: on })" />
      </SettingsRow>
    </template>
  </template>
</template>
