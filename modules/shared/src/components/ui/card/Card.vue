<script setup lang="ts">
// A surface with a border, a corner and room inside: a stat, a summary, a group of settings. Put what it holds in the
// default slot. A `title` (and a `description` under it) make the header; the `header` slot replaces both, `action`
// sits at the header's end, `footer` closes the card. `size` is the padding, from the kit's scale.
// `interactive` makes the whole card a button (or a link with `as="a"`): it answers hover, focus and press. `selected`
// marks the current one. For a card you pick from a group, use `ChoiceCard`.
import type { HTMLAttributes } from "vue"
import { computed, useAttrs } from "vue"
import { useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"
import { DIP_PRESS } from "../button"
import { CARD_BASE, CARD_INTERACTIVE, CARD_PADDING, CARD_SELECTED, type CardSize } from "./look"

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  title?: string
  description?: string
  size?: CardSize
  /** The whole card is one button (or `as="a"`). */
  interactive?: boolean
  as?: "div" | "section" | "article" | "li" | "a"
  selected?: boolean
  disabled?: boolean
  /** Why it is off. While `disabled` it stays hoverable and focusable, and the reason shows in a tooltip beside it. */
  disabledReason?: string
  class?: HTMLAttributes["class"]
}>(), { size: "default", as: "div" })

const attrs = useAttrs()
const tag = computed(() => (props.interactive && props.as !== "a" ? "button" : props.as))
const soft = useSoftDisabled(() => ({ disabled: props.interactive && props.disabled, reason: props.disabledReason, hinted: tag.value === "a" }))
const live = computed(() => props.interactive && !props.disabled)
</script>

<template>
  <component
    :is="tag"
    data-slot="card"
    :type="tag === 'button' ? 'button' : undefined"
    v-bind="{ ...attrs, ...soft.attrs() }"
    :disabled="tag === 'button' ? soft.disabled() : undefined"
    :aria-current="interactive && selected ? 'true' : undefined"
    :data-selected="selected ? '' : undefined"
    :class="cn(
      CARD_BASE,
      CARD_PADDING[size],
      interactive && [CARD_INTERACTIVE, live && DIP_PRESS],
      selected && CARD_SELECTED,
      props.class,
    )"
  >
    <div v-if="title || description || $slots.header || $slots.action" data-slot="card-header" class="flex min-w-0 items-start gap-2">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <slot name="header">
          <p v-if="title" data-slot="card-title" class="truncate text-sm leading-5 font-medium">{{ title }}</p>
          <p v-if="description" data-slot="card-description" class="text-muted-foreground text-xs">{{ description }}</p>
        </slot>
      </div>
      <div v-if="$slots.action" data-slot="card-action" class="flex shrink-0 items-center gap-1"><slot name="action" /></div>
    </div>
    <slot />
    <div v-if="$slots.footer" data-slot="card-footer" class="text-muted-foreground flex items-center gap-2 text-xs"><slot name="footer" /></div>
  </component>
</template>
