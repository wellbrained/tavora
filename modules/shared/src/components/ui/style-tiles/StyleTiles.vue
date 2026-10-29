<script setup lang="ts" generic="T extends string">
// Looks to choose from, each as a small picture with its name under it, such as the styles of an
// overlay. It is a radio group, so arrow keys move between the tiles. Each tile's picture comes
// from the `tile` slot; for many looks or long names a Select with pictures fits better.
import { RadioGroupItem, RadioGroupRoot } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";

const props = defineProps<{ options: { value: T; label: string; testid?: string }[]; label: string; disabled?: boolean; class?: HTMLAttributes["class"] }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <RadioGroupRoot v-model="model" orientation="horizontal" :aria-label="label" :disabled="disabled" data-slot="style-tiles" :class="cn('grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2', props.class)">
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :data-testid="option.testid"
      class="group bg-background hover:border-input focus-visible:outline-ring data-[state=checked]:border-primary data-[state=checked]:bg-primary/10 flex flex-col gap-1.5 rounded-lg border p-1.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50"
    >
      <span class="bg-muted relative block aspect-[16/9] w-full overflow-hidden rounded-md" aria-hidden="true"><slot name="tile" :option="option" :selected="option.value === model" /></span>
      <span class="text-muted-foreground group-data-[state=checked]:text-foreground truncate px-0.5 text-xs font-medium">{{ option.label }}</span>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
