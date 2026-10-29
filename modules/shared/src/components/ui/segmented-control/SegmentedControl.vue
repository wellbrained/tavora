<script setup lang="ts" generic="T extends string">
import { RadioGroupItem, RadioGroupRoot } from "reka-ui";

// A row of mutually exclusive choices, for two to four short options. It is
// a radio group, so arrow keys move between the options.
defineProps<{ options: { value: T; label: string; testid?: string }[]; label: string; disabled?: boolean }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <RadioGroupRoot v-model="model" orientation="horizontal" :aria-label="label" :disabled="disabled" class="bg-background inline-flex flex-none gap-0.5 rounded-lg border p-0.5">
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :data-testid="option.testid"
      class="text-muted-foreground hover:text-foreground focus-visible:outline-ring data-[state=checked]:border-primary/50 data-[state=checked]:bg-primary/15 data-[state=checked]:text-primary h-7 rounded-sm border border-transparent px-3 text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50"
    >
      {{ option.label }}
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
