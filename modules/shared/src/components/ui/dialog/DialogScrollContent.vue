<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { X } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  injectDialogRootContext,
  useForwardPropsEmits,
} from "reka-ui"
import { computed, useAttrs } from "vue"
import { LayerAnchor, useLayer } from "../../../lib/layers"
import { cn } from "../../../lib/utils"
import DialogCloseX from "./DialogCloseX.vue"
import { useDialogDismissal, withoutDismissListener, type DismissEmits, type DismissOptions } from "./dismissal"
import { provideDialogInstant } from "./instant"

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
// On top of the page while open: page keys such as Ctrl+Z stand down and the page around it is inert (layers.ts).
const attrs = useAttrs()
const layer = useLayer("dialog", injectDialogRootContext().open, { name: () => attrs["data-testid"] as string | undefined, kept: () => !!props.forceMount })

// Reka's own events go on to Reka; `dismiss-attempt` is the kit's and stays here.
const forwardedAll = useForwardPropsEmits(delegatedProps, emits)
const forwarded = computed(() => withoutDismissListener(forwardedAll.value))
const dismissal = useDialogDismissal(() => props, attempt => emits("dismiss-attempt", attempt), layer)

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
      class="tavora-dialog-overlay fixed inset-0 z-(--layer-floating) grid place-items-center overflow-y-auto overscroll-contain bg-black/80"
    >
      <DialogContent
        :data-instant="instant ? '' : undefined"
        :class="
          cn(
            'tavora-dialog relative z-(--layer-floating) grid w-full max-w-lg my-8 gap-4 border border-border bg-background p-6 shadow-elevation-3 sm:rounded-lg md:w-full',
            props.class,
          )
        "
        v-bind="{ ...$attrs, ...forwarded }"
        @escape-key-down="dismissal.onEscapeKeyDown"
        @pointer-down-outside="onPointerDownOutside"
      >
        <LayerAnchor />
        <slot />

        <DialogCloseX class="absolute top-4 right-4 p-0.5 transition-colors rounded-md hover:bg-secondary disabled:pointer-events-none disabled:opacity-(--disabled-opacity)">
          <X class="w-4 h-4" />
        </DialogCloseX>
      </DialogContent>
    </DialogOverlay>
  </DialogPortal>
</template>
