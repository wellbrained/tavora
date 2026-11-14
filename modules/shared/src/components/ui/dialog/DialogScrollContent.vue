<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { X } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  useForwardPropsEmits,
} from "reka-ui"
import { computed } from "vue"
import { InertBehind } from "../../../lib/inert-behind"
import { cn } from "../../../lib/utils"
import DialogCloseX from "./DialogCloseX.vue"
import { useDialogDismissal, withoutDismissListener, type DismissEmits, type DismissOptions } from "./dismissal"
import { provideDialogInstant } from "./instant"
import { trackModal } from "./track-modal"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<DialogContentProps & DismissOptions & {
  class?: HTMLAttributes["class"]
  instant?: boolean
}>(), {
  instant: false,
  dismissible: true,
  busy: false,
})
const emits = defineEmits<DialogContentEmits & DismissEmits>()

const delegatedProps = reactiveOmit(props, "class", "instant", "dismissible", "busy")
const instant = provideDialogInstant(() => props.instant)
// Page keys such as Ctrl+Z stand down while it is open (modal.ts).
trackModal()

// Reka's own events go on to Reka; `dismiss-attempt` is the kit's and stays here.
const forwardedAll = useForwardPropsEmits(delegatedProps, emits)
const forwarded = computed(() => withoutDismissListener(forwardedAll.value))
const dismissal = useDialogDismissal(() => props, attempt => emits("dismiss-attempt", attempt))

/** A press on the page's scrollbar is not a press outside; anything else goes through the dismissal rules. */
function onPointerDownOutside(event: CustomEvent<{ originalEvent: PointerEvent }>) {
  const originalEvent = event.detail.originalEvent
  const target = originalEvent.target as HTMLElement
  if (originalEvent.offsetX > target.clientWidth || originalEvent.offsetY > target.clientHeight) event.preventDefault()
  dismissal.onPointerDownOutside(event)
}
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      :data-instant="instant ? '' : undefined"
      class="tavora-dialog-overlay fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80"
    >
      <DialogContent
        :data-instant="instant ? '' : undefined"
        :class="
          cn(
            'tavora-dialog relative z-50 grid w-full max-w-lg my-8 gap-4 border border-border bg-background p-6 shadow-lg sm:rounded-lg md:w-full',
            props.class,
          )
        "
        v-bind="{ ...$attrs, ...forwarded }"
        @escape-key-down="dismissal.onEscapeKeyDown"
        @pointer-down-outside="onPointerDownOutside"
      >
        <InertBehind />
        <slot />

        <DialogCloseX class="absolute top-4 right-4 p-0.5 transition-colors rounded-md hover:bg-secondary disabled:pointer-events-none disabled:opacity-50">
          <X class="w-4 h-4" />
        </DialogCloseX>
      </DialogContent>
    </DialogOverlay>
  </DialogPortal>
</template>
