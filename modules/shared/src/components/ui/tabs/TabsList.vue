<script setup lang="ts">
import type { TabsListProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { TabsList } from "reka-ui"
import { cn } from "../../../lib/utils"

// An underlined row of tabs, like the panel tabs: the selected one carries
// a 2 px gold line.
const props = defineProps<TabsListProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <TabsList
    data-slot="tabs-list"
    v-bind="delegatedProps"
    :class="cn('text-muted-foreground inline-flex h-8 w-fit items-center gap-1 border-b', props.class)"
  >
    <slot />
  </TabsList>
</template>
