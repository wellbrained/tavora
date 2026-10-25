<script setup lang="ts">
// A row of colour swatches to pick from; arrow keys move between them. With `allowCustom`, a "+"
// swatch at the end opens the system colour dialog for any other colour.
import { Check, Plus } from "@lucide/vue";
import { RadioGroupItem, RadioGroupRoot } from "reka-ui";
import { computed, type HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";
import { uiText } from "../text";

const props = defineProps<{
  colors: string[];
  /** Names for screen readers, in the order of `colors`. Without them the colour code is read out. */
  labels?: string[];
  /** The group's name for screen readers. */
  label: string;
  allowCustom?: boolean;
  disabled?: boolean;
  class?: HTMLAttributes["class"];
}>();
const model = defineModel<string>({ required: true });

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isCustom = computed(() => !!model.value && !props.colors.some((color) => same(color, model.value)));
/** A swatch's check needs to stay readable on light and dark colours. */
function isLight(hex: string): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return false;
  const value = parseInt(match[1]!, 16);
  return ((value >> 16) * 299 + ((value >> 8) & 255) * 587 + (value & 255) * 114) / 1000 > 140;
}
/** The native colour input only takes #rrggbb. */
const hexForInput = computed(() => (/^#[0-9a-f]{6}$/i.test(model.value) ? model.value : "#000000"));
const swatch = "grid size-6 flex-none cursor-pointer place-items-center rounded-full border outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:ring-2 data-[state=checked]:ring-ring data-[state=checked]:ring-offset-1 data-[state=checked]:ring-offset-background";
</script>

<template>
  <RadioGroupRoot v-model="model" orientation="horizontal" :aria-label="label" :disabled="disabled" data-slot="color-picker" :class="cn('flex flex-wrap items-center gap-1.5', props.class)">
    <RadioGroupItem
      v-for="(color, index) in colors"
      :key="color"
      :value="color"
      :aria-label="labels?.[index] ?? color"
      :title="labels?.[index] ?? color"
      :class="swatch"
      :style="{ background: color }"
    >
      <Check v-if="same(color, model)" class="size-3.5" :stroke-width="2.5" :style="{ color: isLight(color) ? 'black' : 'white' }" />
    </RadioGroupItem>
    <RadioGroupItem v-if="isCustom" :value="model" :aria-label="model" :title="model" :class="swatch" :style="{ background: model }">
      <Check class="size-3.5" :stroke-width="2.5" :style="{ color: isLight(model) ? 'black' : 'white' }" />
    </RadioGroupItem>
    <label
      v-if="allowCustom"
      :class="cn('border-input text-muted-foreground hover:text-foreground focus-within:outline-ring relative grid size-6 flex-none cursor-pointer place-items-center rounded-full border border-dashed focus-within:outline-2 focus-within:outline-offset-2', disabled && 'pointer-events-none opacity-50')"
      :title="uiText.customColor"
    >
      <Plus class="size-3.5" :stroke-width="2" aria-hidden="true" />
      <input type="color" class="absolute inset-0 size-full cursor-pointer opacity-0" :aria-label="uiText.customColor" :disabled="disabled" :value="hexForInput" @input="model = ($event.target as HTMLInputElement).value" />
    </label>
  </RadioGroupRoot>
</template>
