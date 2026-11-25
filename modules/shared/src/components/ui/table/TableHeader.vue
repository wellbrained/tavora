<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { useTableContext } from "./context"

const props = defineProps<{ class?: HTMLAttributes["class"] }>()
const table = useTableContext()
</script>

<!-- A sticky header draws its line as a shadow: a collapsed border would scroll away with the rows. It sits on the
     page background; restyle it with `class` on a table that sits on a card. -->
<template>
  <thead
    data-slot="table-header"
    :data-sticky="table.stickyHeader() || undefined"
    :class="cn('[&_tr]:border-b', table.stickyHeader() && 'bg-background sticky top-0 z-10 shadow-[inset_0_-1px_var(--border)] [&_tr]:border-b-0', props.class)"
  >
    <slot />
  </thead>
</template>
