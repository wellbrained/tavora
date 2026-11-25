<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { ref } from "vue"
import { cn } from "../../../lib/utils"
import { useFieldControl } from "../field/use-field-control"

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  class?: HTMLAttributes["class"]
  defaultValue?: string | number
  modelValue?: string | number
}>()

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void
}>()

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
const element = ref<HTMLTextAreaElement | null>(null)
const field = useFieldControl({ element: () => element.value, value: () => modelValue.value })
</script>

<template>
  <textarea
    ref="element"
    v-model="modelValue"
    data-slot="textarea"
    v-bind="{ ...$attrs, ...field.attrs() }"
    :class="cn(
      'border-input placeholder:text-muted-foreground aria-invalid:border-destructive dark:bg-input/10 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-(--disabled-opacity)',
      'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
      props.class,
    )"
  />
</template>
