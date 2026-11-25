<script setup lang="ts">
import type { SeparatorProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { Separator } from "reka-ui"
import { computed } from "vue"
import { cn } from "../../../lib/utils"
import { useToolbarJoin } from "../toolbar/context"

const props = withDefaults(defineProps<
  SeparatorProps & { class?: HTMLAttributes["class"] }
>(), {
  orientation: undefined,
  decorative: true,
})

const delegatedProps = reactiveOmit(props, "class", "orientation")
/** In a kit Toolbar it runs across the row (a short upright line), unless it says otherwise. */
const { orientation: toolbarOrientation } = useToolbarJoin()
const orientation = computed(() => props.orientation ?? (toolbarOrientation.value === "horizontal" ? "vertical" : "horizontal"))
</script>

<template>
  <Separator
    data-slot="separator"
    v-bind="delegatedProps"
    :orientation="orientation"
    :class="
      cn(
        'bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        toolbarOrientation && 'data-[orientation=vertical]:mx-0.5 data-[orientation=vertical]:h-5 data-[orientation=horizontal]:my-0.5 data-[orientation=horizontal]:w-5',
        props.class,
      )
    "
  />
</template>
