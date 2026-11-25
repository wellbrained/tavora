<script setup lang="ts">
// A link that sits in text or in a list: the name of an item, a station, a place. It takes the size and colour of the
// text around it, turns primary and underlined on hover, and has the kit's focus ring. The label is cut off with "…"
// where it runs out of room; `wrap` lets it wrap instead, for a link inside a sentence. An `icon` goes in front of the
// label and is part of the link. A real page link is `as="a"` with an `href`.
import type { HTMLAttributes } from "vue"
import { computed, useAttrs } from "vue"
import { useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"

const props = withDefaults(
  defineProps<{
    as?: "button" | "a"
    /** Wraps onto more lines instead of cutting the label off. */
    wrap?: boolean
    disabled?: boolean
    /** Why it is off. While `disabled` it stays hoverable and focusable, and the reason shows in a tooltip beside it. */
    disabledReason?: string
    class?: HTMLAttributes["class"]
  }>(),
  { as: "button", wrap: false, disabled: false },
)

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

// A link has no native `disabled`, so an `a` that is off is always the soft kind: announced as off, takes no click,
// and loses its `href` so it can't be opened in a new tab either.
const soft = useSoftDisabled(() => ({ disabled: props.disabled, reason: props.disabledReason, hinted: props.as === "a" }))
const off = computed(() => props.disabled)
</script>

<template>
  <component
    :is="as"
    data-slot="text-link"
    :type="as === 'button' ? 'button' : undefined"
    v-bind="soft.attrs()"
    :href="off ? undefined : attrs.href"
    :disabled="as === 'button' ? soft.disabled() : undefined"
    :class="
      cn(
        'group/text-link max-w-full min-w-0 cursor-pointer rounded-sm text-left outline-none transition-colors duration-(--duration-press) ease-(--ease-out-strong) focus-visible:ring-3 focus-visible:ring-ring/50',
        wrap ? 'inline [overflow-wrap:anywhere]' : 'inline-flex items-center gap-1.5 align-bottom',
        off ? 'cursor-default opacity-(--disabled-opacity)' : 'hover:text-primary',
        props.class,
      )
    "
  >
    <span v-if="$slots.icon" data-slot="text-link-icon" :class="cn('shrink-0 [&_svg:not([class*=size-])]:size-4', wrap ? 'mr-1.5 inline-block align-[-0.125em]' : 'inline-flex')" aria-hidden="true"><slot name="icon" /></span>
    <span data-slot="text-link-label" :class="cn('underline-offset-3', wrap ? '' : 'min-w-0 truncate', !off && 'group-hover/text-link:underline')"><slot /></span>
  </component>
</template>
