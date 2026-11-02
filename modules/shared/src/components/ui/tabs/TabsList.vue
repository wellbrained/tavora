<script setup lang="ts">
import type { TabsListProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { provide, toRef, useTemplateRef } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { TabsList } from "reka-ui"
import { cn } from "../../../lib/utils"
import { useSlidingIndicator } from "../sliding-indicator"
import { tabsIndicatorKey } from "./context"

// An underlined row of tabs, like the panel tabs: the selected one carries
// a 2 px gold line. The line is one piece that slides to the tab you click, and jumps when the arrow keys pick.
// The tabs may sit in wrappers (a tooltip's span): the line is placed by measuring, not by where they are in the
// DOM. When no tab can be found or measured, the active tab draws its own line instead.
// `indicator: false` leaves it to the tabs: each draws its own line at once, for a strip whose tabs come, go and
// move all the time (TabStrip).
const props = withDefaults(defineProps<TabsListProps & { class?: HTMLAttributes["class"]; indicator?: boolean }>(), { indicator: true })

const delegatedProps = reactiveOmit(props, "class", "indicator")

const root = useTemplateRef("root")
provide(tabsIndicatorKey, toRef(props, "indicator"))
useSlidingIndicator(root, { selector: '[role="tab"][data-state="active"]', enabled: () => props.indicator })
</script>

<template>
  <TabsList
    ref="root"
    data-slot="tabs-list"
    v-bind="delegatedProps"
    :class="cn('text-muted-foreground group/tabs relative inline-flex h-8 w-fit items-center gap-1 border-b', props.class)"
  >
    <!-- Where the tab's own bottom border used to be: the measured box's bottom 2 px. A border, not a background, so
         it stays when Windows high contrast takes backgrounds away. -->
    <span v-if="indicator" aria-hidden="true" class="tavora-indicator border-primary top-[calc(var(--indicator-y,0px)+var(--indicator-h,0px)-2px)] h-0.5 border-b-2" data-testid="tabs-line" />
    <slot />
  </TabsList>
</template>
