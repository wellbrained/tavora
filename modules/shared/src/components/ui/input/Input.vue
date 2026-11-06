<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"

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
</script>

<template>
  <input
    v-model="modelValue"
    data-slot="input"
    v-bind="soft.attrs()"
    :disabled="soft.disabled()"
    :readonly="soft.soft() || undefined"
    :class="cn(
      'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/10 border-input h-8 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
      'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
      'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
      props.class,
    )"
  >
</template>
