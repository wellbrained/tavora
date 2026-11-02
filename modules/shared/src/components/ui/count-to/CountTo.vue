<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { computed } from "vue"
import { cn } from "../../../lib/utils"
import { formatCount, stepDecimals, type CountKind } from "./tween"
import { useCountTo } from "./use-count-to"

interface Props {
  /** The number to show. A `percent` is a fraction: 0.25 shows "25%". */
  value: number
  kind?: CountKind
  /** Places after the point (`decimal` shows one unless told, `percent` none). */
  decimals?: number
  /** The locale to write the number in; the page's language if left out. */
  locale?: string
  /**
   * Writes the whole text around the number, for a sentence like "3 left": it gets the number on its way to the
   * value, so a plural follows what is shown. Without it only the number is written.
   */
  format?: (shown: number) => string
  class?: HTMLAttributes["class"]
}

const props = withDefaults(defineProps<Props>(), { kind: "integer" })

const shown = useCountTo(
  () => props.value,
  { get decimals() { return stepDecimals(props.kind, props.decimals) } },
)

const text = computed(() => {
  if (props.format) return props.format(shown.value)
  const locale = props.locale ?? (typeof document === "undefined" ? undefined : document.documentElement.lang || undefined)
  return formatCount(shown.value, props.kind, locale, props.decimals)
})
</script>

<template>
  <span data-slot="count-to" :class="cn('tabular-nums', props.class)">{{ text }}</span>
</template>
