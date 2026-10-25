<script setup lang="ts">
// The element that opens the popover when pressed.
import type { PopoverTriggerProps } from "reka-ui";
import { PopoverTrigger } from "reka-ui";

const props = defineProps<PopoverTriggerProps>();
</script>

<template>
  <PopoverTrigger data-slot="popover-trigger" v-bind="props">
    <slot />
  </PopoverTrigger>
</template>
