<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import type { ButtonVariants } from "."
import { Primitive } from "reka-ui"
import { useAttrs } from "vue"
import { cn } from "../../../lib/utils"
import { buttonVariants } from "."

interface Props extends PrimitiveProps {
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  class?: HTMLAttributes["class"]
  disabled?: boolean
  /**
   * Has a hint of its own (a tooltip you show yourself, not a `title`). A disabled button with a `title` or this stays
   * reachable, so the hint still shows and says why it is off. A disabled button without one is a plain disabled button.
   */
  hinted?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  as: "button",
  disabled: false,
  hinted: false,
})

const attrs = useAttrs()

/**
 * A native `disabled` button gets no pointer events and no focus, so its tooltip never shows and a keyboard or screen
 * reader user can't reach the reason. With a hint it is `aria-disabled` instead: still hoverable and focusable, still
 * announced as off, but it takes no click, press or menu-opening key.
 */
const soft = () => props.disabled && (props.hinted || String(attrs.title ?? "").trim() !== "")

/** Stops what the button would do (its own click handler, a menu trigger around it, a form submit) while it is soft. */
function stop(event: Event) {
  if (!soft()) return
  event.preventDefault()
  event.stopImmediatePropagation()
}
const PRESS_KEYS = new Set(["Enter", " ", "ArrowDown", "ArrowUp"])
function stopKey(event: KeyboardEvent) {
  if (PRESS_KEYS.has(event.key)) stop(event)
}
</script>

<template>
  <Primitive
    data-slot="button"
    :data-variant="variant"
    :data-size="size"
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({ variant, size, soft: soft() }), props.class)"
    :disabled="soft() ? undefined : props.disabled || undefined"
    :aria-disabled="soft() ? 'true' : undefined"
    :data-disabled="soft() ? '' : undefined"
    @click.capture="stop"
    @pointerdown.capture="stop"
    @mousedown.capture="stop"
    @keydown.capture="stopKey"
  >
    <slot />
  </Primitive>
</template>
