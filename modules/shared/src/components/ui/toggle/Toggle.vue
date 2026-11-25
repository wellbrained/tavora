<script setup lang="ts">
// A button that stays pressed, such as Bold or Italic next to a text size. Several of them side by side
// stay separate buttons; for a joined row of them use ToggleGroup.
import { Toggle } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";
import { toggleClass } from "./variants";
import { useToolbarJoin } from "../toolbar/context";
import ToolbarItem from "../toolbar/ToolbarItem.vue";

const props = defineProps<{ label: string; disabled?: boolean; class?: HTMLAttributes["class"] }>();
const model = defineModel<boolean>({ default: false });
/** In a kit Toolbar it is one of the toolbar's arrow-key stops. */
const { joined } = useToolbarJoin();
</script>

<template>
  <ToolbarItem :join="joined" :focusable="!disabled">
    <Toggle v-model="model" :aria-label="label" :title="label" :disabled="disabled" data-slot="toggle" :class="cn(toggleClass, 'rounded-md', props.class)">
      <slot />
    </Toggle>
  </ToolbarItem>
</template>
