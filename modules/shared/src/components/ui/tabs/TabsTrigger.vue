<script setup lang="ts">
import type { TabsTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { inject, ref } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { TabsTrigger, useForwardProps } from "reka-ui"
import { cn } from "../../../lib/utils"
import { tabsIndicatorKey } from "./context"

const props = defineProps<TabsTriggerProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)

// The list draws the selected line when it can (it slides); otherwise the tab's own bottom border is the line.
const listDraws = inject(tabsIndicatorKey, ref(false))
</script>

<template>
  <TabsTrigger
    data-slot="tabs-trigger"
    v-bind="forwardedProps"
    :class="cn(
      'hover:text-foreground data-[state=active]:text-foreground -mb-px inline-flex h-full items-center justify-center gap-1.5 border-b-2 border-transparent px-2 text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
      !listDraws && 'data-[state=active]:border-primary',
      props.class,
    )"
  >
    <slot />
  </TabsTrigger>
</template>
