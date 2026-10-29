<script setup lang="ts">
import type { SelectRootEmits, SelectRootProps } from "reka-ui"
import { SelectRoot, useForwardPropsEmits } from "reka-ui"
import { computed, provide, ref } from "vue"
import { emptyChoicesKey, fromInner, toInner } from "./empty"

const props = defineProps<SelectRootProps>()
const emits = defineEmits<SelectRootEmits>()

// A `SelectItem value=""` is an empty choice: picking it clears the value to "" and its text shows in the trigger.
const emptyChoices = ref(0)
provide(emptyChoicesKey, { add: () => emptyChoices.value++, remove: () => emptyChoices.value-- })

const forwarded = useForwardPropsEmits(props, emits)
const bound = computed((): Record<string, unknown> => ({
  ...forwarded.value,
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
