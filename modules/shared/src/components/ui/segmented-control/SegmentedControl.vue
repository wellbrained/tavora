<script setup lang="ts" generic="T extends string">
import { useTemplateRef } from "vue";
import { RadioGroupItem, RadioGroupRoot } from "reka-ui";
import { useSlidingIndicator } from "../sliding-indicator";

// A row of mutually exclusive choices, for two to four short options. It is
// a radio group, so arrow keys move between the options.
// One pill sits behind the picked option and slides to a new one when you click; it jumps when the arrow keys
// pick, and it is not shown while nothing is picked or the control is disabled.
defineProps<{ options: { value: T; label: string; testid?: string }[]; label: string; disabled?: boolean }>();
const model = defineModel<T>({ required: true });

const root = useTemplateRef("root");
useSlidingIndicator(root, { selector: '[role="radio"][data-state="checked"]:not([data-disabled])' });
</script>

<template>
  <RadioGroupRoot ref="root" v-model="model" orientation="horizontal" :aria-label="label" :disabled="disabled" class="bg-background group/segmented relative inline-flex flex-none gap-0.5 rounded-lg border p-0.5">
    <span aria-hidden="true" class="tavora-indicator border-primary/50 bg-primary/15 rounded-sm border" data-testid="segmented-pill" />
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :data-testid="option.testid"
      class="text-muted-foreground hover:text-foreground focus-visible:outline-ring data-[state=checked]:text-primary relative h-7 rounded-sm border border-transparent px-3 text-sm font-medium whitespace-nowrap transition-[color] group-data-[indicator=jump]/segmented:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50"
    >
      {{ option.label }}
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
