<script setup lang="ts">
// A button inside the popover that closes it.
import type { PopoverCloseProps } from "reka-ui";
import { PopoverClose } from "reka-ui";

const props = defineProps<PopoverCloseProps>();
</script>

<template>
  <PopoverClose data-slot="popover-close" v-bind="props">
    <slot />
  </PopoverClose>
</template>
