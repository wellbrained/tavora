<script setup lang="ts">
// A setting you turn on or off: the Switch with its label and, if it helps, one line under it.
// Clicking the label toggles it too. Attributes such as `title` or `data-testid` go on the whole field.
// `placement="end"` puts the switch after the label, as one row of the kit's control height (a toolbar, a dialog's
// option): the whole row is the target, and `switchAttrs` reach the switch itself (a test id, a data attribute).
import type { HTMLAttributes } from "vue"
import { useId } from "vue"
import { CONTROL_MIN_HEIGHT, type ControlSize } from "../../../lib/control-size"
import { isSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"
import { REASON_ATTRIBUTE } from "../../../title-tooltips"
import { Label } from "../label"
import Switch from "./Switch.vue"

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  label: string
  description?: string
  disabled?: boolean
  /** Why it is off. While `disabled` the switch and its label stay hoverable and focusable, and the reason shows in a tooltip beside them. */
  disabledReason?: string
  /** The id of the switch itself; made up when left out. */
  id?: string
  /** The id of what this switch shows or hides (aria-controls). */
  controls?: string
  /** Where the switch sits: before the label (the default) or after it, at the end of the row. */
  placement?: "start" | "end"
  /** The row's least height, from the kit's scale; for `placement="end"`. */
  size?: ControlSize
  /** Classes for the label text, such as one that hides it in a narrow panel; for `placement="end"`. */
  labelClass?: HTMLAttributes["class"]
  /** Attributes for the switch itself, such as `data-testid`; the others go on the whole field. */
  switchAttrs?: Record<string, unknown>
  class?: HTMLAttributes["class"]
}>(), { placement: "start", size: "default" })
const model = defineModel<boolean>({ default: false })
const made = useId()
const switchId = () => props.id ?? `switch-${made}`
// The label says it too, so hovering the words explains as well as hovering the switch.
const reasonAttrs = () => (isSoftDisabled({ disabled: props.disabled, reason: props.disabledReason }) ? { [REASON_ATTRIBUTE]: props.disabledReason!.trim() } : {})
</script>

<template>
  <Label
    v-if="placement === 'end'"
    data-slot="switch-field"
    data-placement="end"
    :for="switchId()"
    v-bind="{ ...reasonAttrs(), ...$attrs }"
    :class="cn(
      'flex w-full min-w-0 gap-3 rounded-md px-2 py-1 text-sm leading-5 font-normal',
      CONTROL_MIN_HEIGHT[size],
      description ? 'items-start' : 'items-center',
      disabled ? 'cursor-not-allowed opacity-(--disabled-opacity)' : 'cursor-pointer',
      props.class,
    )"
  >
    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span :id="`${switchId()}-label`" data-slot="switch-field-label" :class="cn('truncate', labelClass)">{{ label }}</span>
      <span v-if="description" :id="`${switchId()}-description`" class="text-muted-foreground text-xs">{{ description }}</span>
    </span>
    <Switch
      v-bind="switchAttrs"
      :id="switchId()"
      v-model="model"
      :class="description && 'mt-0.5'"
      :disabled="disabled"
      :disabled-reason="disabledReason"
      :aria-controls="controls"
      :aria-labelledby="`${switchId()}-label`"
      :aria-describedby="description ? `${switchId()}-description` : undefined"
    />
  </Label>
  <div v-else data-slot="switch-field" v-bind="$attrs" :class="cn('flex items-start gap-3', props.class)">
    <Switch :id="switchId()" v-model="model" class="mt-px" :disabled="disabled" :disabled-reason="disabledReason" :aria-controls="controls" :aria-describedby="description ? `${switchId()}-description` : undefined" />
    <div class="flex min-w-0 flex-col gap-0.5">
      <Label :for="switchId()" class="leading-5 font-normal" :class="disabled ? 'cursor-not-allowed opacity-(--disabled-opacity)' : 'cursor-pointer'" v-bind="reasonAttrs()">{{ label }}</Label>
      <p v-if="description" :id="`${switchId()}-description`" class="text-muted-foreground text-xs">{{ description }}</p>
    </div>
  </div>
</template>
