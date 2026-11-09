<script setup lang="ts" generic="T extends string">
// Looks to choose from, each as a small picture with its name under it, such as the styles of an
// overlay. It is a radio group, so arrow keys move between the tiles. Each tile's picture comes
// from the `tile` slot; for many looks or long names a Select with pictures fits better.
import { RadioGroupItem, RadioGroupRoot } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { useKeyTravel } from "../../../lib/key-travel";
import { cn } from "../../../lib/utils";

const props = defineProps<{ options: { value: T; label: string; testid?: string }[]; label: string; disabled?: boolean; class?: HTMLAttributes["class"] }>();
const model = defineModel<T>({ required: true });
// Arrow keys move through the tiles without animating; a click does.
const travel = useKeyTravel();
</script>

<template>
  <RadioGroupRoot
    v-model="model"
    orientation="horizontal"
    :aria-label="label"
    :disabled="disabled"
    data-slot="style-tiles"
    :data-travel="travel.travelling.value ? '' : undefined"
    :class="cn('grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2', props.class)"
    @keydown.capture="travel.onKeydown"
    @keyup="travel.end"
    @pointerdown.capture="travel.end"
    @focusout="travel.onFocusout"
  >
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :data-testid="option.testid"
      class="tavora-quiet-travel group bg-background hover:border-input focus-visible:outline-ring data-[state=checked]:border-primary data-[state=checked]:bg-primary/10 flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-[background-color,border-color,scale] duration-(--duration-press) ease-(--ease-out-strong) [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:not-disabled:active:scale-95 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50"
    >
      <span class="bg-muted relative block aspect-[16/9] w-full overflow-hidden rounded-md" aria-hidden="true"><slot name="tile" :option="option" :selected="option.value === model" /></span>
      <span class="tavora-quiet-travel text-muted-foreground group-data-[state=checked]:text-foreground truncate px-0.5 text-xs font-medium transition-colors duration-(--duration-press) ease-(--ease-out-strong)">{{ option.label }}</span>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
