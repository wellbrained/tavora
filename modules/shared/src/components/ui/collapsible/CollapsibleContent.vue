<script setup lang="ts">
// What the section shows when it's open. It grows open and shuts by height (motion.css, .tavora-collapse). `force-mount`
// keeps it in the page while closed (hidden), for content that other code reaches into.
// Put padding and a divider on this element's own class: they animate with the height. Keep margins off it.
import type { CollapsibleContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { CollapsibleContent, injectCollapsibleRootContext } from "reka-ui"
import { ref, watch } from "vue"
import { cn } from "../../../lib/utils"

const props = defineProps<CollapsibleContentProps & { class?: HTMLAttributes["class"] }>()
const delegatedProps = reactiveOmit(props, "class")

// The motion plays from the first open or close on. Until then a section just sits as it was given (closed ones
// hidden), so a force-mounted section that starts closed does not shut itself on load.
const root = injectCollapsibleRootContext()
const armed = ref(false)
watch(() => root.open.value, () => (armed.value = true))
</script>

<template>
  <CollapsibleContent data-slot="collapsible-content" v-bind="delegatedProps" :data-armed="armed ? '' : undefined" :class="cn('tavora-collapse overflow-hidden', props.class)">
    <slot />
  </CollapsibleContent>
</template>
