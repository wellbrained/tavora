<script setup lang="ts">
// The heading row that opens and closes the section: a full-width button with a chevron that turns when it's open.
import type { CollapsibleTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { ChevronRight } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { CollapsibleTrigger } from "reka-ui"
import { cn } from "../../../lib/utils"

const props = defineProps<CollapsibleTriggerProps & { class?: HTMLAttributes["class"] }>()
const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <CollapsibleTrigger
    data-slot="collapsible-trigger"
    v-bind="delegatedProps"
    :class="cn('group/trigger focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-md text-left text-sm font-medium outline-none focus-visible:ring-3', props.class)"
  >
    <ChevronRight class="text-muted-foreground size-4 shrink-0 transition-transform group-data-[state=open]/trigger:rotate-90" :stroke-width="1.5" aria-hidden="true" />
    <slot />
  </CollapsibleTrigger>
</template>
