<script setup lang="ts">
// A slider for one number with its value and unit at the end, "70 %" say, so the setting reads
// without dragging. Arrow keys move by `step`, Page Up and Down by ten steps.
import { computed, type HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";
import Slider from "./Slider.vue";

const props = withDefaults(defineProps<{ min: number; max: number; step?: number; unit?: string; label: string; disabled?: boolean; class?: HTMLAttributes["class"] }>(), { step: 1, unit: "" });
const model = defineModel<number>({ required: true });
const values = computed({
  get: () => [model.value],
  set: (next: number[]) => next[0] !== undefined && (model.value = next[0]),
});
</script>

<template>
  <div data-slot="slider-field" :class="cn('flex w-full items-center gap-3', props.class)">
    <Slider v-model="values" :min="min" :max="max" :step="step" :disabled="disabled" :aria-label="label" class="min-w-0 flex-1" />
    <output class="text-muted-foreground w-11 flex-none text-right text-sm whitespace-nowrap tabular-nums" data-slot="slider-value">{{ model }}{{ unit && ` ${unit}` }}</output>
  </div>
</template>
