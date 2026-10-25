<script setup lang="ts">
// What the section shows when it's open. `force-mount` keeps it in the page while closed (hidden), for content that other code reaches into.
import type { CollapsibleContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { CollapsibleContent } from "reka-ui"
import { cn } from "../../../lib/utils"

const props = defineProps<CollapsibleContentProps & { class?: HTMLAttributes["class"] }>()
const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <CollapsibleContent data-slot="collapsible-content" v-bind="delegatedProps" :class="cn('overflow-hidden', props.class)">
    <slot />
  </CollapsibleContent>
</template>
