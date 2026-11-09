<script setup lang="ts">
import type { SelectRootEmits, SelectRootProps } from "reka-ui"
import { reactiveOmit } from "@vueuse/core"
import { SelectRoot, useForwardPropsEmits } from "reka-ui"
import { computed, provide, ref, shallowReactive } from "vue"
import { isSoftDisabled } from "../../../lib/soft-disabled"
import { choiceLabelsKey, emptyChoicesKey, fromInner, offReasonKey, toInner } from "./empty"

const props = defineProps<SelectRootProps & {
  /** Why it is off. While `disabled` the trigger stays hoverable and focusable, and the reason shows in a tooltip beside it. */
  disabledReason?: string
}>()
const emits = defineEmits<SelectRootEmits>()

// A `SelectItem value=""` is an empty choice: picking it clears the value to "" and its text shows in the trigger.
const emptyChoices = ref(0)
provide(emptyChoicesKey, { add: () => emptyChoices.value++, remove: () => emptyChoices.value-- })

// What each choice says right now, so the trigger never shows words that were renamed or translated since.
const labels = shallowReactive(new Map<unknown, string>())
provide(choiceLabelsKey, {
  set: (value, label) => { if (labels.get(value) !== label) labels.set(value, label) },
  remove: (value) => { labels.delete(value) },
  get: (value) => labels.get(value),
})

// Off with a reason: Reka is not told it is disabled (it would make the trigger unreachable); the trigger takes over.
const soft = computed(() => isSoftDisabled({ disabled: props.disabled, reason: props.disabledReason }))
provide(offReasonKey, computed(() => (soft.value ? props.disabledReason!.trim() : undefined)))

const forwarded = useForwardPropsEmits(reactiveOmit(props, "disabledReason"), emits)
const bound = computed((): Record<string, unknown> => ({
  ...forwarded.value,
  ...(soft.value ? { disabled: undefined } : {}),
  modelValue: toInner(props.modelValue, emptyChoices.value > 0),
  "onUpdate:modelValue": (value: unknown) => emits("update:modelValue", fromInner(value) as never),
}))
</script>

<template>
  <SelectRoot
    v-slot="slotProps"
    data-slot="select"
    v-bind="bound"
  >
    <slot v-bind="slotProps" />
  </SelectRoot>
</template>
