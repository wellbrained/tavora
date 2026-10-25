<script setup lang="ts">
// Where the popover points, when something other than the trigger should carry it.
import type { PopoverAnchorProps } from "reka-ui";
import { PopoverAnchor } from "reka-ui";

const props = defineProps<PopoverAnchorProps>();
</script>

<template>
  <PopoverAnchor data-slot="popover-anchor" v-bind="props">
    <slot />
  </PopoverAnchor>
</template>
