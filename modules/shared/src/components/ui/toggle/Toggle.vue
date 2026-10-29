<script setup lang="ts">
// A button that stays pressed, such as Bold or Italic next to a text size. Several of them side by side
// stay separate buttons; for a joined row of them use ToggleGroup.
import { Toggle } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";
import { toggleClass } from "./variants";

const props = defineProps<{ label: string; disabled?: boolean; class?: HTMLAttributes["class"] }>();
const model = defineModel<boolean>({ default: false });
</script>

<template>
  <Toggle v-model="model" :aria-label="label" :title="label" :disabled="disabled" data-slot="toggle" :class="cn(toggleClass, 'rounded-md', props.class)">
    <slot />
  </Toggle>
</template>
