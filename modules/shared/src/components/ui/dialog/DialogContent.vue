<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { X } from "@lucide/vue"
import { reactiveOmit, useEventListener, useResizeObserver } from "@vueuse/core"
import {
  DialogClose,
  DialogContent,
  DialogPortal,
  injectDialogRootContext,
  useForwardPropsEmits,
} from "reka-ui"
import { nextTick, shallowRef, watch } from "vue"
import { cn } from "../../../lib/utils"
import { uiText } from "../text"
import DialogOverlay from "./DialogOverlay.vue"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<DialogContentProps & { class?: HTMLAttributes["class"], showCloseButton?: boolean }>(), {
  showCloseButton: true,
})
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)

// A dialog opened on top of another one stays inside it: centred in the dialogs that were already open
// when it opened, and never bigger than they are. Without this it is placed against the window, and a
// dialog pinned near the window's top sticks out above a tall dialog like Settings. The styles are set
// here rather than bound, so a dialog keeps its own width unless it is wider than the room it has.
const INSET = 16
const root = injectDialogRootContext()
const parents = shallowRef<HTMLElement[]>([])
const content = () => (root.open.value ? root.contentElement.value : undefined)

watch(root.open, async (open) => {
  parents.value = []
  if (!open) return
  await nextTick()
  const element = content()
  if (!element) return
  parents.value = [...document.querySelectorAll<HTMLElement>("[data-slot=\"dialog-content\"][data-state=\"open\"]")].filter(other => other !== element)
  place()
}, { immediate: true, flush: "post" })

function place() {
  const element = content()
  const rects = parents.value.filter(parent => parent.isConnected).map(parent => parent.getBoundingClientRect())
  if (!element || !rects.length) return
  const top = Math.max(...rects.map(rect => rect.top))
  const left = Math.max(...rects.map(rect => rect.left))
  const width = Math.max(0, Math.min(...rects.map(rect => rect.right)) - left - 2 * INSET)
  const height = Math.max(0, Math.min(...rects.map(rect => rect.bottom)) - top - 2 * INSET)
  const style = element.style
  element.dataset.nested = ""
  style.top = `${top + INSET + height / 2}px`
  style.left = `${left + INSET + width / 2}px`
  style.translate = "-50% -50%"
  style.maxHeight = `${height}px`
  style.overflowY = "auto"
  style.maxWidth = ""
  if (element.offsetWidth > width) style.maxWidth = `${width}px`
}

useResizeObserver(parents, place)
useEventListener(window, "resize", place)
</script>

<template>
  <DialogPortal>
    <DialogOverlay />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[min(420px,calc(100%-2rem))] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200',
          props.class,
        )"
    >
      <slot />

      <DialogClose
        v-if="showCloseButton"
        data-slot="dialog-close"
        class="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
      >
        <X />
        <span class="sr-only">{{ uiText.close }}</span>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
