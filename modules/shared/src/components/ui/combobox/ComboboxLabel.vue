<script setup lang="ts">
import type { ComboboxLabelProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { ComboboxLabel } from "reka-ui"
import { cn } from "../../../lib/utils"

const props = defineProps<ComboboxLabelProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <ComboboxLabel
    data-slot="combobox-label"
    v-bind="delegatedProps"
    :class="cn('text-muted-foreground px-2 py-1.5 text-xs', props.class)"
  >
    <slot />
  </ComboboxLabel>
</template>
