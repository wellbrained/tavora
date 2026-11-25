<script setup lang="ts">
// One row. Options:
// - `current`: the row that is you or yours (your place on a leaderboard), in the accent colour; screen readers hear it.
// - `selected`: a row the user picked.
// - `tone`: colours the row's numeric cells, for a value that is better, worse or needs a look.
// - `marked`: a line on its start edge and bold numbers, for a row that differs from the usual.
import { computed, type HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import type { TableRowTone } from "./context"

const props = defineProps<{ class?: HTMLAttributes["class"]; current?: boolean; selected?: boolean; tone?: TableRowTone; marked?: boolean }>()

const toneClass: Record<TableRowTone, string> = {
  positive: "[&_[data-numeric]]:text-success",
  negative: "[&_[data-numeric]]:text-destructive",
  warning: "[&_[data-numeric]]:text-warning",
  muted: "[&_[data-numeric]]:text-muted-foreground",
}

const classes = computed(() =>
  cn(
    "data-[state=selected]:bg-muted border-b transition-colors",
    props.current ? "bg-accent/60 font-medium" : "hover:bg-muted/50",
    props.tone && toneClass[props.tone],
    props.marked && "[&>:first-child]:shadow-[inset_2px_0_var(--primary)] [&_[data-numeric]]:font-bold",
    props.class,
  ),
)
</script>

<template>
  <tr
    data-slot="table-row"
    :data-state="selected ? 'selected' : undefined"
    :data-tone="tone"
    :data-marked="marked || undefined"
    :aria-current="current ? 'true' : undefined"
    :class="classes"
  >
    <slot />
  </tr>
</template>
