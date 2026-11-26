<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { onMounted, ref, watch } from "vue"
import { cn } from "../../../lib/utils"
import { useFieldControl } from "../field/use-field-control"
import { BARE_FIELD } from "../input/look"

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  class?: HTMLAttributes["class"]
  defaultValue?: string | number
  modelValue?: string | number
  /** `bare`: no edge until hovered or focused, for text edited in place. */
  variant?: "default" | "bare"
  /** As tall as its text, from one line (`rows` sets another start), without a resize handle. A `max-h-*` class caps it. */
  autosize?: boolean
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

// `field-sizing: content` does the growing; where a browser lacks it, the height is set from the text.
const sizesItself = typeof CSS !== "undefined" && !!CSS.supports?.("field-sizing", "content")
function fit() {
  const el = element.value
  if (!props.autosize || sizesItself || !el) return
  el.style.height = "auto"
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
}
onMounted(fit)
watch(modelValue, fit, { flush: "post" })
</script>

<template>
  <textarea
    ref="element"
    v-model="modelValue"
    data-slot="textarea"
    :data-variant="props.variant === 'bare' ? 'bare' : undefined"
    :rows="props.autosize ? 1 : undefined"
    v-bind="{ ...$attrs, ...field.attrs() }"
    @input="fit"
    :class="cn(
      'border-input placeholder:text-muted-foreground aria-invalid:border-destructive dark:bg-input/10 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-(--disabled-opacity)',
      'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
      props.autosize && 'min-h-0 resize-none',
      props.variant === 'bare' && BARE_FIELD,
      props.class,
    )"
  />
</template>
