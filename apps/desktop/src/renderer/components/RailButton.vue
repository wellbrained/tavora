<script setup lang="ts">
// One row or tile of the rail, as the kit's ghost Button with what the rail draws itself taken off: the Button's height,
// padding, corners, hover fill and focus ring. The rail's own tiles keep their 20 % corners, hover fill and keyboard
// outline (styles.css, #974); each use sets its own size and look with classes, as a Button does anywhere else.
import type { HTMLAttributes } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { cn } from "@tavora/official-ui/lib/utils";

const props = defineProps<{ class?: HTMLAttributes["class"] }>();
defineOptions({ inheritAttrs: false });

/** Written out in full: Tailwind only finds class names that appear in the source as plain strings. */
const RAIL =
  "h-auto shrink justify-normal gap-0 rounded-none p-0 text-base font-normal whitespace-normal shadow-none hover:bg-transparent hover:text-inherit focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";
</script>

<template>
  <Button variant="ghost" v-bind="$attrs" :class="cn(RAIL, props.class)"><slot /></Button>
</template>
