<script setup lang="ts">
import type { DropdownMenuContentEmits, DropdownMenuContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  injectDropdownMenuRootContext,
  useForwardPropsEmits,
} from "reka-ui"
import { LayerAnchor, useLayer } from "../../../lib/layers"
import { cn } from "../../../lib/utils"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<DropdownMenuContentProps & { class?: HTMLAttributes["class"] }>(),
  {
    sideOffset: 4,
    // Starts at the button's left edge and opens to the right; reka moves it over when there is no room.
    align: "start",
  },
)
const emits = defineEmits<DropdownMenuContentEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
const root = injectDropdownMenuRootContext()
// On top of the page while open; a modal menu makes the page around it inert (layers.ts).
useLayer("menu", root.open, { modal: () => root.modal.value })
</script>

<template>
  <DropdownMenuPortal>
    <DropdownMenuContent
      data-slot="dropdown-menu-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="cn('bg-popover text-popover-foreground tavora-popup z-50 max-h-(--reka-dropdown-menu-content-available-height) min-w-[max(8rem,var(--reka-dropdown-menu-trigger-width))] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border p-1 shadow-lg', props.class)"
    >
      <LayerAnchor />
      <slot />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>
