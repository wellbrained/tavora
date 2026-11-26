<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { ref } from "vue"
import { useSoftDisabled } from "../../../lib/soft-disabled"
import { controlSize, type ControlSize } from "../../../lib/control-size"
import { cn } from "../../../lib/utils"
import { useFieldControl } from "../field/use-field-control"
import { INPUT_SIZE, inputLook } from "./look"

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  class?: HTMLAttributes["class"]
  disabled?: boolean
  /**
   * Why it is off. While `disabled` the field stays hoverable and focusable (read-only, so its text can still be
   * copied), and the reason shows in a tooltip beside it.
   */
  disabledReason?: string
  /** The kit's size scale: as tall as a Button of the same size. */
  size?: ControlSize
}>()

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void
}>()

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
// Enter in a read-only field would still submit its form.
const soft = useSoftDisabled(() => ({ disabled: props.disabled, reason: props.disabledReason }), { keys: new Set(["Enter"]), pointer: false })
const element = ref<HTMLInputElement | null>(null)
const field = useFieldControl({ element: () => element.value, value: () => modelValue.value })
</script>

<template>
  <input
    ref="element"
    v-model="modelValue"
    data-slot="input"
    v-bind="{ ...soft.attrs(), ...field.attrs() }"
    :disabled="soft.disabled()"
    :readonly="soft.soft() || undefined"
    :class="cn(...inputLook, INPUT_SIZE[controlSize(props.size)], props.class)"
  >
</template>
