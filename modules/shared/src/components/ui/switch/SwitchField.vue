<script setup lang="ts">
// A setting you turn on or off: the Switch with its label and, if it helps, one line under it.
// Clicking the label toggles it too. Attributes such as `title` or `data-testid` go on the whole field.
import type { HTMLAttributes } from "vue"
import { useId } from "vue"
import { isSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"
import { REASON_ATTRIBUTE } from "../../../title-tooltips"
import { Label } from "../label"
import Switch from "./Switch.vue"

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  label: string
  description?: string
  disabled?: boolean
  /** Why it is off. While `disabled` the switch and its label stay hoverable and focusable, and the reason shows in a tooltip beside them. */
  disabledReason?: string
  /** The id of the switch itself; made up when left out. */
  id?: string
  /** The id of what this switch shows or hides (aria-controls). */
  controls?: string
  class?: HTMLAttributes["class"]
}>()
const model = defineModel<boolean>({ default: false })
const made = useId()
const switchId = () => props.id ?? `switch-${made}`
// The label says it too, so hovering the words explains as well as hovering the switch.
const reasonAttrs = () => (isSoftDisabled({ disabled: props.disabled, reason: props.disabledReason }) ? { [REASON_ATTRIBUTE]: props.disabledReason!.trim() } : {})
</script>

<template>
  <div data-slot="switch-field" v-bind="$attrs" :class="cn('flex items-start gap-3', props.class)">
    <Switch :id="switchId()" v-model="model" class="mt-px" :disabled="disabled" :disabled-reason="disabledReason" :aria-controls="controls" :aria-describedby="description ? `${switchId()}-description` : undefined" />
    <div class="flex min-w-0 flex-col gap-0.5">
      <Label :for="switchId()" class="leading-5 font-normal" :class="disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'" v-bind="reasonAttrs()">{{ label }}</Label>
      <p v-if="description" :id="`${switchId()}-description`" class="text-muted-foreground text-xs">{{ description }}</p>
    </div>
  </div>
</template>
