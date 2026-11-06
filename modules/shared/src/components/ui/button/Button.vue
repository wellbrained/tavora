<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import type { ButtonVariants } from "."
import { Primitive } from "reka-ui"
import { useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"
import { buttonVariants } from "."

interface Props extends PrimitiveProps {
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  /** `dip` (wide controls) only dips 1px when pressed; the default `scale` also shrinks to 97% and turns itself to `dip` when stretched. */
  press?: ButtonVariants["press"]
  class?: HTMLAttributes["class"]
  disabled?: boolean
  /**
   * Has a hint of its own (a tooltip you show yourself, not a `title`). A disabled button with a `title` or this stays
   * reachable, so the hint still shows and says why it is off. A disabled button without one is a plain disabled button.
   */
  hinted?: boolean
  /** Why it is off. While `disabled` the button stays hoverable and focusable, and the reason shows in a tooltip beside it. */
  disabledReason?: string
}

const props = withDefaults(defineProps<Props>(), {
  as: "button",
  disabled: false,
  hinted: false,
})

defineOptions({ inheritAttrs: false })

/**
 * A native `disabled` button gets no pointer events and no focus, so its tooltip never shows and a keyboard or screen
 * reader user can't reach the reason. With a hint it is `aria-disabled` instead: still hoverable and focusable, still
 * announced as off, but it takes no click, press or menu-opening key.
 */
const soft = useSoftDisabled(() => ({ disabled: props.disabled, reason: props.disabledReason, hinted: props.hinted }))
</script>

<template>
  <Primitive
    data-slot="button"
    :data-variant="variant"
    :data-size="size"
    :as="as"
    :as-child="asChild"
    v-bind="soft.attrs()"
    :class="cn(buttonVariants({ variant, size, press, soft: soft.soft() }), props.class)"
    :disabled="soft.disabled()"
  >
    <slot />
  </Primitive>
</template>
