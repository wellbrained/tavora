<script setup lang="ts">
// One option of a `RadioGroup` with its label and, if it helps, one line under it, as one row with a hover fill: the radio
// twin of `CheckboxField`. Clicking anywhere on the row picks it. Put several in a `RadioGroup` (`class="gap-0.5"`), which
// holds the value. `leading` (a swatch, an icon) sits between the dot and the label, `trailing` (a count, a kind) at the
// end. The row dims as a whole while it is off. `size` is the row's least height, from the kit's scale.
// Attributes such as `title` or `data-testid` go on the whole row. For a card with a title and a picture, use `ChoiceCard`.
import type { HTMLAttributes } from "vue"
import { useId } from "vue"
import { CONTROL_MIN_HEIGHT, type ControlSize } from "../../../lib/control-size"
import { isSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"
import { REASON_ATTRIBUTE } from "../../../title-tooltips"
import { Label } from "../label"
import { RadioGroupItem } from "../radio-group"

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  value: string
  label: string
  description?: string
  disabled?: boolean
  /** Why it is off. While `disabled` the dot and its row stay hoverable and focusable, and the reason shows in a tooltip beside them. */
  disabledReason?: string
  size?: ControlSize
  /** The id of the radio itself; made up when left out. */
  id?: string
  class?: HTMLAttributes["class"]
}>(), { size: "default" })
const made = useId()
const radioId = () => props.id ?? `radio-${made}`
const reasonAttrs = () => (isSoftDisabled({ disabled: props.disabled, reason: props.disabledReason }) ? { [REASON_ATTRIBUTE]: props.disabledReason!.trim() } : {})
</script>

<template>
  <Label
    data-slot="radio-field"
    :for="radioId()"
    v-bind="{ ...reasonAttrs(), ...$attrs }"
    :class="cn(
      'group/radio-field flex w-full min-w-0 gap-2.5 rounded-md px-2 py-1 text-sm leading-5 font-normal transition-colors duration-(--duration-press) ease-(--ease-out-strong)',
      CONTROL_MIN_HEIGHT[size],
      description ? 'items-start' : 'items-center',
      disabled ? 'cursor-not-allowed opacity-(--disabled-opacity)' : 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))]',
      props.class,
    )"
  >
    <RadioGroupItem
      :id="radioId()"
      :value="value"
      :class="[description && 'mt-0.5', 'disabled:opacity-100 aria-disabled:opacity-100']"
      :disabled="disabled"
      :disabled-reason="disabledReason"
      :aria-labelledby="`${radioId()}-label`"
      :aria-describedby="description ? `${radioId()}-description` : undefined"
    />
    <span v-if="$slots.leading" data-slot="radio-field-leading" class="inline-flex shrink-0 items-center self-center [&_svg:not([class*=size-])]:size-4"><slot name="leading" /></span>
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span :id="`${radioId()}-label`" data-slot="radio-field-label" class="truncate">{{ label }}</span>
      <span v-if="description" :id="`${radioId()}-description`" class="text-muted-foreground text-xs">{{ description }}</span>
    </span>
    <span v-if="$slots.trailing" data-slot="radio-field-trailing" class="text-muted-foreground inline-flex shrink-0 items-center gap-1 self-center text-xs tabular-nums"><slot name="trailing" /></span>
  </Label>
</template>
