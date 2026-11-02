<script setup lang="ts">
// What the section shows when it's open. It grows open and shuts by height (motion.css, .tavora-collapse). `force-mount`
// keeps it in the page while closed (hidden), for content that other code reaches into.
// Put its spacing on this element's own class (padding, a divider, a top padding instead of a gap): it animates with the
// height. No margins on it, and no `gap` or open-dependent padding on the Collapsible around it.
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
// Once the close has played it is taken out of the layout (`shut`), as a section that started closed is.
const root = injectCollapsibleRootContext()
const content = ref<{ $el?: Element } | null>(null)
const armed = ref(false)
const shut = ref(false)
watch(
  () => root.open.value,
  async (open) => {
    armed.value = true
    shut.value = false
    if (open) return
    // Wait a frame: reka measures the section with its animation switched off and switches it back on after the next
    // tick; asking before that would find "none" on a section that is about to shut with a motion.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    if (root.open.value) return
    const node = content.value?.$el
    if (node && getComputedStyle(node).animationName === "none") shut.value = true
  },
)

function onAnimationEnd(event: AnimationEvent) {
  if (event.target === event.currentTarget && !root.open.value && event.animationName?.startsWith("tavora-collapse")) shut.value = true
}
</script>

<template>
  <CollapsibleContent
    ref="content"
    data-slot="collapsible-content"
    v-bind="delegatedProps"
    :data-armed="armed ? '' : undefined"
    :data-shut="shut ? '' : undefined"
    :class="cn('tavora-collapse overflow-hidden', props.class)"
    @animationend="onAnimationEnd"
  >
    <slot />
  </CollapsibleContent>
</template>
