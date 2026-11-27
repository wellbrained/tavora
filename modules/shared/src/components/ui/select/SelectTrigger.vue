<script setup lang="ts">
import type { SelectTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { ChevronsUpDown } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { SelectIcon, SelectTrigger, useForwardProps } from "reka-ui"
import { computed, inject, provide, ref } from "vue"
import { ANY_KEY, useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"
import { cutValueKey, offReasonKey } from "./empty"

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<SelectTriggerProps & {
    class?: HTMLAttributes["class"]
    /** The kit's size scale: as tall as a Button of the same size. `auto`: as tall as what `#value` holds (a picture, two lines). */
    size?: "sm" | "default" | "lg" | "auto"
    /** Why it is off. While `disabled` the trigger stays hoverable and focusable, and the reason shows in a tooltip beside it. */
    disabledReason?: string
  }>(),
  { size: "default" },
)

const delegatedProps = reactiveOmit(props, "class", "size", "disabledReason")
const forwardedProps = useForwardProps(delegatedProps)

// The reason can sit on the Select (with its `disabled`) or on the trigger.
const fromSelect = inject(offReasonKey, undefined)
const reason = computed(() => props.disabledReason ?? fromSelect?.value)
const soft = useSoftDisabled(
  () => ({ disabled: props.disabled || !!fromSelect?.value, reason: reason.value }),
  // A closed select opens on a click or a key, and also picks by typing letters or the arrows.
  { keys: ANY_KEY },
)

// A value the field has to cut short shows whole in its tooltip. A hint of the trigger's own stays the first line, with
// the value under it. Not while off with a reason: the reason is what the tooltip then says.
const cutValue = ref("")
provide(cutValueKey, (value) => { cutValue.value = value })
function withCutValue(attrs: Record<string, unknown>) {
  const value = cutValue.value
  if (!value || (reason.value && soft.soft())) return attrs
  const title = String(attrs.title ?? "")
  if (!title) return { ...attrs, title: value }
  if (title.includes(value) || attrs["data-tooltip-description"]) return attrs
  return { ...attrs, "data-tooltip-description": value }
}
</script>

<template>
  <SelectTrigger
    data-slot="select-trigger"
    :data-size="size"
    v-bind="withCutValue({ ...forwardedProps, ...soft.attrs() })"
    :disabled="soft.disabled()"
    :class="cn(
      'border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*=\'text-\'])]:text-muted-foreground aria-invalid:border-destructive dark:bg-input/10 dark:hover:bg-input/20 tavora-pill flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-(--pill-px) py-1.5 text-sm whitespace-nowrap transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-(--disabled-opacity) aria-disabled:cursor-not-allowed aria-disabled:opacity-(--disabled-opacity) data-[size=default]:min-h-[var(--style-control-height,32px)] data-[size=sm]:min-h-[calc(var(--style-control-height,32px)-4px)] data-[size=lg]:min-h-[calc(var(--style-control-height,32px)+8px)] data-[size=auto]:min-h-[var(--style-control-height,32px)] data-[size=auto]:py-1.5 data-[size=auto]:pl-1.5 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
      'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
      // Side padding that grows near a full round (pill.css), by size.
      '[--pill-border:1px] [--pill-height:var(--style-control-height,32px)] [--pill-pad:--spacing(3)] data-[size=sm]:[--pill-height:calc(var(--style-control-height,32px)-4px)] data-[size=lg]:[--pill-height:calc(var(--style-control-height,32px)+8px)] data-[size=lg]:[--pill-pad:--spacing(4)]',
      props.class,
    )"
  >
    <!-- The value with a picture, icon or swatch in front: `#value` holds both, such as `<KingMark /><SelectValue />`. -->
    <span v-if="$slots.value" data-slot="select-trigger-value" class="flex min-w-0 flex-1 items-center gap-2.5 text-left"><slot name="value" /></span>
    <slot v-else />
    <SelectIcon as-child>
      <ChevronsUpDown class="size-4 opacity-70" />
    </SelectIcon>
  </SelectTrigger>
</template>
