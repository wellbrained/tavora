<script setup lang="ts">
import type { ComboboxInputEmits, ComboboxInputProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { Search } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { ComboboxInput, useForwardPropsEmits } from "reka-ui"
import { cn } from "../../../lib/utils"

defineOptions({
  inheritAttrs: false,
})

// Looks like the kit's Input, with a search icon in front unless `icon` is false.
const props = withDefaults(
  defineProps<ComboboxInputProps & { class?: HTMLAttributes["class"], icon?: boolean }>(),
  { icon: true },
)
const emits = defineEmits<ComboboxInputEmits>()

const delegatedProps = reactiveOmit(props, "class", "icon")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <div class="relative w-full">
    <Search
      v-if="icon"
      class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
      :stroke-width="1.5"
    />
    <ComboboxInput
      data-slot="combobox-input"
      v-bind="{ ...$attrs, ...forwarded }"
      autocomplete="off"
      spellcheck="false"
      :class="cn(
        'placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/10 border-input h-8 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
        icon && 'pl-8',
        props.class,
      )"
    />
  </div>
</template>
