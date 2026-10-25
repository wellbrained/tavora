<script setup lang="ts">
// A small floating panel that opens from a button or another element and holds any content, such as a short form.
import type { PopoverRootEmits, PopoverRootProps } from "reka-ui";
import { PopoverRoot, useForwardPropsEmits } from "reka-ui";

const props = defineProps<PopoverRootProps>();
const emits = defineEmits<PopoverRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <PopoverRoot v-slot="slotProps" data-slot="popover" v-bind="forwarded">
    <slot v-bind="slotProps" />
  </PopoverRoot>
</template>
