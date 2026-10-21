<script setup lang="ts">
import type { ComboboxGroupProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { ComboboxGroup } from "reka-ui"
import { cn } from "../../../lib/utils"

const props = defineProps<ComboboxGroupProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <ComboboxGroup
    data-slot="combobox-group"
    v-bind="delegatedProps"
    :class="cn(props.class)"
  >
    <slot />
  </ComboboxGroup>
</template>
