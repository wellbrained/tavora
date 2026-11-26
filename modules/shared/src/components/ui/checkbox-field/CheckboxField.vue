<script setup lang="ts">
// An option you tick: the Checkbox with its label and, if it helps, one line under it, as one row with a hover fill.
// Clicking anywhere on the row ticks it. `leading` (a swatch, an icon) sits between the box and the label, `trailing`
// (a count, a kind) at the end. `v-model` is `true`, `false` or `"indeterminate"` (some of a group). For a setting that
// is on or off, use `SwitchField`. `size` is the row's least height, from the kit's scale.
// Attributes such as `title` or `data-testid` go on the whole row.
import type { HTMLAttributes } from "vue"
import { useId } from "vue"
import { CONTROL_MIN_HEIGHT, type ControlSize } from "../../../lib/control-size"
import { isSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"
import { REASON_ATTRIBUTE } from "../../../title-tooltips"
import { Checkbox } from "../checkbox"
import { Label } from "../label"

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  label: string
  description?: string
  disabled?: boolean
  /** Why it is off. While `disabled` the box and its row stay hoverable and focusable, and the reason shows in a tooltip beside them. */
  disabledReason?: string
  size?: ControlSize
  /** The id of the box itself; made up when left out. */
  id?: string
  class?: HTMLAttributes["class"]
}>(), { size: "default" })
const model = defineModel<boolean | "indeterminate">({ default: false })
const made = useId()
const boxId = () => props.id ?? `checkbox-${made}`
const reasonAttrs = () => (isSoftDisabled({ disabled: props.disabled, reason: props.disabledReason }) ? { [REASON_ATTRIBUTE]: props.disabledReason!.trim() } : {})
</script>

<template>
  <Label
    data-slot="checkbox-field"
    :for="boxId()"
    v-bind="{ ...reasonAttrs(), ...$attrs }"
    :class="cn(
      'group/checkbox-field flex w-full min-w-0 items-start gap-2.5 rounded-md px-2 py-1 text-sm leading-5 font-normal transition-colors duration-(--duration-press) ease-(--ease-out-strong)',
      CONTROL_MIN_HEIGHT[size],
      disabled ? 'cursor-not-allowed opacity-(--disabled-opacity)' : 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))]',
      props.class,
    )"
  >
    <Checkbox
      :id="boxId()"
      v-model="model"
      class="mt-0.5"
      :disabled="disabled"
      :disabled-reason="disabledReason"
      :aria-describedby="description ? `${boxId()}-description` : undefined"
    />
    <span v-if="$slots.leading" data-slot="checkbox-field-leading" class="inline-flex shrink-0 items-center self-center [&_svg:not([class*=size-])]:size-4"><slot name="leading" /></span>
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span data-slot="checkbox-field-label" class="truncate">{{ label }}</span>
      <span v-if="description" :id="`${boxId()}-description`" class="text-muted-foreground text-xs">{{ description }}</span>
    </span>
    <span v-if="$slots.trailing" data-slot="checkbox-field-trailing" class="text-muted-foreground inline-flex shrink-0 items-center gap-1 self-center text-xs tabular-nums"><slot name="trailing" /></span>
  </Label>
</template>
