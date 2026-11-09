<script setup lang="ts">
import type { SelectValueProps } from "reka-ui"
import { SelectValue } from "reka-ui"
import { inject } from "vue"
import { choiceLabelsKey, pickedLabel } from "./empty"

const props = defineProps<SelectValueProps>()
const labels = inject(choiceLabelsKey, null)
</script>

<template>
  <SelectValue
    v-slot="{ selectedLabel, modelValue }"
    data-slot="select-value"
    v-bind="props"
  >
    <!-- Your own content wins. Otherwise: the live label of what is picked (or the placeholder), a few words per line
         that break between words and end in "…" when there is no more room. -->
    <slot>
      <span class="line-clamp-2 min-w-0 text-start break-words whitespace-normal">{{ (labels ? pickedLabel(modelValue, labels, selectedLabel) : selectedLabel.join(", ")) || props.placeholder }}</span>
    </slot>
  </SelectValue>
</template>
