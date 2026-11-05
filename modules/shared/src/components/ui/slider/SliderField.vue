<script setup lang="ts">
// A slider for one number with its value and unit at the end, "70 %" say, so the setting reads without dragging.
// Keys on the thumb (Reka's): arrows move by `step`, Shift+arrow and Page Up/Down by ten steps (kept between min and
// max), Home and End jump to the limits.
//
// Two opt-ins; without them the field is the slider and a read-only value, as it always was:
// - `editable` turns the value into a small box you can type in. The number is clamped to min and max and moved onto
//   the step when you leave the box or press Enter; Escape puts the old number back. The unit stays beside it.
// - `resetValue` adds a "Reset" button before the slider that shows while the value differs from it. Its room is kept
//   while it is hidden, so nothing jumps. Pass `resetLabel` in the user's language.
// With either on, the row never squeezes: the slider keeps a least width and the box (or the value) drops under it
// when the row is too narrow.
import { computed, nextTick, ref, useTemplateRef, watch, type HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";
import { Button } from "../button";
import { Input } from "../input";
import Slider from "./Slider.vue";
import { commitTyped } from "./slider-field";

const props = withDefaults(
  defineProps<{
    min: number;
    max: number;
    step?: number;
    unit?: string;
    /** Names the slider (and the box) for screen readers. */
    label: string;
    /** The value becomes a box you can type in. */
    editable?: boolean;
    /** Shows a Reset button while the value is another number than this. */
    resetValue?: number;
    /** The Reset button's text; modules pass the translated word. */
    resetLabel?: string;
    disabled?: boolean;
    class?: HTMLAttributes["class"];
  }>(),
  { step: 1, unit: "", resetLabel: "Reset" },
);
const model = defineModel<number>({ required: true });
const values = computed({
  get: () => [model.value],
  set: (next: number[]) => next[0] !== undefined && (model.value = next[0]),
});

const root = useTemplateRef<HTMLElement>("root");
// Either opt-in wraps the row instead of squeezing it; without them the layout is the plain one.
const roomy = computed(() => props.editable || props.resetValue !== undefined);
const showReset = computed(() => props.resetValue !== undefined && model.value !== props.resetValue);

const draft = ref(String(model.value));
watch(model, (value) => (draft.value = String(value)));
const changed = () => draft.value !== String(model.value);

function commit() {
  const next = commitTyped(draft.value, props.min, props.max, props.step);
  if (next !== null) model.value = next;
  // Also when nothing changed (72 snapped back to 70): the box shows the number the field really has.
  draft.value = String(model.value);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && changed()) {
    event.preventDefault();
    commit();
  } else if (event.key === "Escape" && changed()) {
    // Only takes the key while there is something to put back; otherwise Escape still closes what is around the field.
    event.preventDefault();
    event.stopPropagation();
    draft.value = String(model.value);
  }
}

function reset() {
  if (props.resetValue === undefined) return;
  model.value = props.resetValue;
  // The button is hidden now; keep the keyboard where the user is by moving to the slider.
  void nextTick(() => root.value?.querySelector<HTMLElement>("[data-slot=slider-thumb]")?.focus());
}
</script>

<template>
  <div
    ref="root"
    data-slot="slider-field"
    :class="cn('flex w-full items-center', roomy ? 'flex-wrap gap-x-3 gap-y-1.5' : 'gap-3', props.class)"
  >
    <Button
      v-if="resetValue !== undefined"
      type="button"
      variant="ghost"
      size="xs"
      :disabled="disabled"
      :class="cn('text-muted-foreground -ml-2 flex-none', !showReset && 'invisible')"
      data-slot="slider-reset"
      @click="reset"
    >
      {{ resetLabel }}
    </Button>
    <Slider v-model="values" :min="min" :max="max" :step="step" :disabled="disabled" :aria-label="label" :class="roomy ? 'min-w-24 grow basis-24' : 'min-w-0 flex-1'" />
    <span v-if="editable" class="flex flex-none items-center gap-1">
      <Input
        :model-value="draft"
        :disabled="disabled"
        :aria-label="label"
        inputmode="decimal"
        autocomplete="off"
        class="h-7 w-16 px-2 text-right text-sm tabular-nums"
        data-slot="slider-input"
        @update:model-value="draft = String($event)"
        @focus="($event.target as HTMLInputElement).select()"
        @blur="commit"
        @keydown="onKeydown"
      />
      <span v-if="unit" class="text-muted-foreground text-sm whitespace-nowrap" data-slot="slider-unit">{{ unit }}</span>
    </span>
    <output v-else class="text-muted-foreground w-11 flex-none text-right text-sm whitespace-nowrap tabular-nums" data-slot="slider-value">{{ model }}{{ unit && ` ${unit}` }}</output>
  </div>
</template>
