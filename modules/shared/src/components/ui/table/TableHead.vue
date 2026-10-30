<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"

const props = withDefaults(defineProps<{ class?: HTMLAttributes["class"]; scope?: "col" | "row" }>(), { scope: "col" })
</script>

<template>
  <th data-slot="table-head" :scope="scope" :class="cn('text-muted-foreground h-9 px-2 text-left align-middle text-xs font-medium', props.class)">
    <slot />
  </th>
</template>
