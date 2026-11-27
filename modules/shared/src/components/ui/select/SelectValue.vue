<script setup lang="ts">
import type { SelectValueProps } from "reka-ui"
import { reactiveOmit, useMutationObserver, useResizeObserver } from "@vueuse/core"
import { SelectValue } from "reka-ui"
import { inject, onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue"
import { cn } from "../../../lib/utils"
import { isTruncated } from "../../tooltip/use-tooltip"
import { choiceLabelsKey, cutValueKey, pickedLabel } from "./empty"

const props = defineProps<SelectValueProps & {
  /**
   * Lets a long value take a second line before it ends in "…", for a field that stands on its own. Off: one line, so
   * a field in a row of controls stays as high as the others. Either way a cut value shows whole in the trigger's tooltip.
   */
  wrap?: boolean
}>()
const forwarded = reactiveOmit(props, "wrap")
const labels = inject(choiceLabelsKey, null)

// The trigger shows the whole value in its tooltip while this one cuts it.
const report = inject(cutValueKey, null)
const text = useTemplateRef<HTMLElement>("text")
function measure() {
  const element = text.value
  report?.(element && isTruncated(element) ? element.textContent!.trim() : "")
}
useResizeObserver(text, measure)
useMutationObserver(text, measure, { childList: true, characterData: true, subtree: true })
onMounted(measure)
watch([text, () => props.wrap], measure, { flush: "post" })
onBeforeUnmount(() => report?.(""))
</script>

<template>
  <SelectValue
    v-slot="{ selectedLabel, modelValue }"
    data-slot="select-value"
    v-bind="forwarded"
    class="min-w-0"
  >
    <!-- Your own content wins. Otherwise: the live label of what is picked (or the placeholder), on one line that ends in
         "…" when there is no more room (with `wrap`, on two lines that break between words). One line is a clamp that
         breaks anywhere, not `truncate`: so the words never hold the field, or what is around it, wider than its place. -->
    <slot>
      <span
        ref="text"
        :class="cn('min-w-0 text-start whitespace-normal', props.wrap ? 'line-clamp-2 break-words' : 'line-clamp-1 break-all')"
      >{{ (labels ? pickedLabel(modelValue, labels, selectedLabel) : selectedLabel.join(", ")) || props.placeholder }}</span>
    </slot>
  </SelectValue>
</template>
