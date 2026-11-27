<script setup lang="ts">
// The popover's panel, drawn above everything else with the same surface as a menu.
import type { PopoverContentEmits, PopoverContentProps } from "reka-ui";
import type { HTMLAttributes } from "vue";
import { reactiveOmit } from "@vueuse/core";
import { PopoverContent, PopoverPortal, useForwardPropsEmits } from "reka-ui";
import { cn } from "../../../lib/utils";
import { leaveToolbar } from "../toolbar/context";

// What it holds is not part of a Toolbar around its trigger.
leaveToolbar();

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<PopoverContentProps & { class?: HTMLAttributes["class"] }>(), {
  align: "center",
  sideOffset: 4,
  collisionPadding: 8,
});
const emits = defineEmits<PopoverContentEmits>();

const delegatedProps = reactiveOmit(props, "class");
const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <PopoverPortal>
    <PopoverContent
      data-slot="popover-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="cn('bg-popover text-popover-foreground tavora-popup focus-visible:outline-ring z-(--layer-floating) w-72 max-w-[calc(100vw-16px)] rounded-md border p-3 shadow-elevation-2 outline-hidden', props.class)"
    >
      <slot />
    </PopoverContent>
  </PopoverPortal>
</template>
