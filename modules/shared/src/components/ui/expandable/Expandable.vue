<script setup lang="ts">
// Long content cut to a set height, fading out at the bottom, with "Show more" below it.
// Short content shows in full without the button. Expanded, the content takes its full
// height; the caller's scroll container decides what that does to the layout.
import type { HTMLAttributes } from "vue"
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue"
import { cn } from "../../../lib/utils"
import { Button } from "../button"
import { uiText } from "../text"

const props = withDefaults(defineProps<{
  /** Height of the cut content, in pixels. */
  maxHeight?: number
  class?: HTMLAttributes["class"]
}>(), { maxHeight: 160 })

const id = useId()
/** The content at its natural height, inside the box that cuts it. */
const content = ref<HTMLElement>()
const expanded = ref(false)
/** Whether the content is taller than maxHeight, so there is anything to show more of. */
const overflows = ref(false)
const cut = computed(() => overflows.value && !expanded.value)

let observer: ResizeObserver | undefined
onMounted(() => {
  const measure = () => {
    if (content.value) overflows.value = content.value.offsetHeight > props.maxHeight + 1
  }
  observer = new ResizeObserver(measure)
  observer.observe(content.value!)
  measure()
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div data-slot="expandable" :class="cn('flex flex-col items-start', props.class)">
    <div
      :id="id"
      class="w-full overflow-hidden"
      :style="cut ? { maxHeight: `${maxHeight}px`, maskImage: 'linear-gradient(to bottom, black 60%, transparent)' } : undefined"
    >
      <div ref="content" class="flow-root"><slot /></div>
    </div>
    <Button
      v-if="overflows"
      variant="link"
      size="sm"
      class="mt-1 h-auto px-0"
      :aria-expanded="expanded"
      :aria-controls="id"
      data-slot="expandable-toggle"
      @click="expanded = !expanded"
    >{{ expanded ? uiText.showLess : uiText.showMore }}</Button>
  </div>
</template>
