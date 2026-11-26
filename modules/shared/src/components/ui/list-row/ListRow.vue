<script setup lang="ts">
// A whole list row as one button: a search hit, a place, a channel, a sound to add. It has room for a picture or icon in
// front (`leading`), the label, a second line (`description`) and something at the end (`trailing`, such as a kind, a
// count or a temperature). The label is cut off with "…"; `wrap` lets label and second line wrap instead.
// `selected` marks the current row (a soft primary tint; `aria-current`, or `aria-selected` in a `role="option"` row).
// A row that leads to a page or view takes `navigation`: selected, it says `aria-current="page"`, as NavList does.
// `highlighted` is the keyboard highlight of a list that keeps the focus itself (a listbox): it only changes the look.
// An `a` that is off loses its `href`, so it can't be opened in a new tab either.
// `as="div"` is a row that looks the same but does nothing, such as the channel you are already in.
// Put it in your own `<li>`; it is only the row.
import type { HTMLAttributes } from "vue"
import { computed, useAttrs } from "vue"
import { useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"
import { CONTROL_MIN_HEIGHT, type ControlSize } from "../../../lib/control-size"
import { DIP_PRESS } from "../button"

const props = withDefaults(
  defineProps<{
    as?: "button" | "a" | "div"
    selected?: boolean
    /** The row leads to a page or view, so a selected one says `aria-current="page"`. */
    navigation?: boolean
    highlighted?: boolean
    /** Wraps the label and the second line instead of cutting them off. */
    wrap?: boolean
    disabled?: boolean
    /** Why it is off. While `disabled` it stays hoverable and focusable, and the reason shows in a tooltip beside it. */
    disabledReason?: string
    /** Its least height on the kit's size scale (it grows with a second line). */
    size?: ControlSize
    class?: HTMLAttributes["class"]
  }>(),
  { as: "button", selected: false, navigation: false, highlighted: false, wrap: false, disabled: false, size: "default" },
)

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const interactive = computed(() => props.as !== "div")
// A link has no native `disabled`, so an `a` that is off is always the soft kind: announced as off, takes no click.
const soft = useSoftDisabled(() => ({ disabled: interactive.value && props.disabled, reason: props.disabledReason, hinted: props.as === "a" }))
const off = computed(() => interactive.value && props.disabled)
const live = computed(() => interactive.value && !off.value)

/** The same fill as a ghost Button's hover, for a hovered or highlighted row. */
const HOVER_FILL = "bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))]"

/**
 * An option row says it is chosen with `aria-selected` (always set, as listboxes expect); any other with `aria-current`.
 * Called from the template, so a `role` that changes later is read again (attributes aren't tracked by a computed).
 */
function selection() {
  return attrs.role === "option" ? { "aria-selected": props.selected ? "true" : "false" } : props.selected ? { "aria-current": props.navigation ? "page" : "true" } : {}
}
</script>

<template>
  <component
    :is="as"
    data-slot="list-row"
    :type="as === 'button' ? 'button' : undefined"
    v-bind="{ ...soft.attrs(), ...selection() }"
    :href="off ? undefined : attrs.href"
    :disabled="as === 'button' ? soft.disabled() : undefined"
    :data-selected="selected ? '' : undefined"
    :data-highlighted="highlighted ? '' : undefined"
    :class="
      cn(
        'group/list-row flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-[color,background-color,translate] duration-(--duration-press) ease-(--ease-out-strong) focus-visible:inset-ring-2 focus-visible:inset-ring-ring',
        CONTROL_MIN_HEIGHT[size],
        $slots.description && 'py-1.5',
        live && ['cursor-pointer', `hover:${HOVER_FILL}`, DIP_PRESS],
        highlighted && HOVER_FILL,
        selected && 'bg-primary/10',
        selected && live && 'hover:bg-primary/15',
        selected && highlighted && 'bg-primary/15',
        off && 'cursor-default opacity-(--disabled-opacity)',
        props.class,
      )
    "
  >
    <span v-if="$slots.leading" data-slot="list-row-leading" class="inline-flex min-w-5 shrink-0 items-center justify-center [&_svg:not([class*=size-])]:size-4"><slot name="leading" /></span>
    <span data-slot="list-row-label" class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span :class="wrap ? '[overflow-wrap:anywhere]' : 'truncate'"><slot /></span>
      <span v-if="$slots.description" data-slot="list-row-description" :class="cn('text-muted-foreground text-xs font-normal', wrap ? '[overflow-wrap:anywhere]' : 'truncate')"><slot name="description" /></span>
    </span>
    <span v-if="$slots.trailing" data-slot="list-row-trailing" :class="cn('flex shrink-0 items-center gap-1.5 text-xs', selected ? 'text-primary' : 'text-muted-foreground')"><slot name="trailing" /></span>
  </component>
</template>
