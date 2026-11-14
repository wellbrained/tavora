<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit, useEventListener, useResizeObserver } from "@vueuse/core"
import {
  DialogContent,
  DialogPortal,
  injectDialogRootContext,
  useForwardPropsEmits,
} from "reka-ui"
import { computed, nextTick, provide, ref, shallowRef, toRef, useAttrs, watch } from "vue"
import { LayerAnchor, useLayer } from "../../../lib/layers"
import { cn } from "../../../lib/utils"
import { dialogChromeKey, dialogCloseClass } from "./chrome"
import DialogCloseX from "./DialogCloseX.vue"
import DialogOverlay from "./DialogOverlay.vue"
import { useDialogDismissal, withoutDismissListener, type DismissEmits, type DismissOptions } from "./dismissal"
import { provideDialogInstant } from "./instant"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<DialogContentProps & DismissOptions & {
  class?: HTMLAttributes["class"]
  showCloseButton?: boolean
  instant?: boolean
}>(), {
  showCloseButton: true,
  instant: false,
  dismissible: true,
  busy: false,
})
const emits = defineEmits<DialogContentEmits & DismissEmits>()

const delegatedProps = reactiveOmit(props, "class", "showCloseButton", "instant", "dismissible", "busy")

// Opened by a key (or closed with Escape), or `instant` for a dialog that never animates: no rise, no fade (instant.ts).
const instant = provideDialogInstant(() => props.instant)
const root = injectDialogRootContext()
// On top of the page while open: page keys such as Ctrl+Z stand down and the page around it is inert (layers.ts).
const attrs = useAttrs()
const layer = useLayer("dialog", root.open, { name: () => attrs["data-testid"] as string | undefined })

// A DialogHeader with a title draws the close X itself (centred against the title); without one the X sits in the corner.
const headerClose = ref(false)
provide(dialogChromeKey, { showClose: toRef(props, "showCloseButton"), headerClose })

// Reka's own events go on to Reka; `dismiss-attempt` is the kit's and stays here.
const forwardedAll = useForwardPropsEmits(delegatedProps, emits)
const forwarded = computed(() => withoutDismissListener(forwardedAll.value))
const dismissal = useDialogDismissal(() => props, attempt => emits("dismiss-attempt", attempt), layer)

// The header's close X comes first in the page, so the dialog's own focus would land on it. Focus what the user came
// to do instead: an `autofocus` element, else the first field or button that is not the X. A caller's own
// `@open-auto-focus` runs first and may prevent this.
const TABBABLE = "a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex=\"-1\"])"
function focusFirst(event: Event) {
  if (event.defaultPrevented) return
  const element = content()
  if (!element) return
  const target = element.querySelector<HTMLElement>("[autofocus]")
    ?? [...element.querySelectorAll<HTMLElement>(TABBABLE)].find(candidate => !candidate.matches("[data-slot=\"dialog-close\"]"))
  event.preventDefault()
  ;(target ?? element).focus()
}

// A dialog opened on top of another one stays inside it: centred in the dialogs that were already open
// when it opened, and never bigger than they are. Without this it is placed against the window, and a
// dialog pinned near the window's top sticks out above a tall dialog like Settings. The styles are set
// here rather than bound, so a dialog keeps its own width unless it is wider than the room it has.
const INSET = 16
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
  // A parent still rising into place is measured a few pixels off: place again once it has settled.
  const settling = parents.value.flatMap(parent => parent.getAnimations().map(animation => animation.finished))
  if (!settling.length) return
  await Promise.allSettled(settling)
  if (content() === element) place()
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
      :data-instant="instant ? '' : undefined"
      v-bind="{ ...$attrs, ...forwarded }"
      @open-auto-focus="focusFirst"
      @escape-key-down="dismissal.onEscapeKeyDown"
      @pointer-down-outside="dismissal.onPointerDownOutside"
      :class="
        cn(
          'tavora-dialog bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-[min(420px,calc(100%-2rem))] translate-x-[-50%] translate-y-[-50%] gap-6 rounded-lg border p-6 shadow-lg',
          props.class,
        )"
    >
      <LayerAnchor />
      <slot />

      <DialogCloseX v-if="showCloseButton && !headerClose" :class="cn(dialogCloseClass, 'absolute top-[17px] right-6')" />
    </DialogContent>
  </DialogPortal>
</template>
