<script setup lang="ts" generic="T extends string">
// A joined row of toggle buttons that can each stay pressed, such as Bold, Italic and Underline.
// For buttons that should stay apart, use single Toggles; for one choice out of several, SegmentedControl.
import { ToggleGroupItem, ToggleGroupRoot } from "reka-ui";
import type { Component, HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";
import { toggleClass } from "./variants";

const props = defineProps<{
  /** `text` is what the button shows when it has no icon, "B" for Bold say; `label` is its name. */
  options: { value: T; label: string; icon?: Component; text?: string; testid?: string }[];
  /** The group's name for screen readers. */
  label: string;
  disabled?: boolean;
  class?: HTMLAttributes["class"];
}>();
const model = defineModel<T[]>({ required: true });
</script>

<template>
  <ToggleGroupRoot v-model="model" type="multiple" :aria-label="label" :disabled="disabled" data-slot="toggle-group" :class="cn('inline-flex flex-none', props.class)">
    <ToggleGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :aria-label="option.label"
      :title="option.label"
      :data-testid="option.testid"
      :class="cn(toggleClass, 'rounded-none not-first:-ml-px first:rounded-l-md last:rounded-r-md focus-visible:z-20 data-[state=on]:z-10')"
    >
      <component :is="option.icon" v-if="option.icon" class="size-4" :stroke-width="1.75" aria-hidden="true" />
      <span v-else aria-hidden="true">{{ option.text ?? option.label }}</span>
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>
