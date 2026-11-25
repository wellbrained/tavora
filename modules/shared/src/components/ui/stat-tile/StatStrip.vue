<script setup lang="ts">
// A row of StatTiles. As many equal columns as fit the strip's width (each tile at least 7rem), with even rows: four
// tiles go 4, then 2×2, then one under the other. `columns` fixes the count instead.
import type { HTMLAttributes } from "vue"
import { computed, onBeforeUnmount, onMounted, onUpdated, provide, ref, toRef } from "vue"
import { cn } from "../../../lib/utils"
import { STAT_STRIP, stripColumns, type StatTileVariant } from "./context"

const props = withDefaults(
  defineProps<{
    /** `filled`: soft muted tiles. `outlined`: a bordered tile on the page colour. */
    variant?: StatTileVariant
    /** A fixed number of columns, whatever the width. */
    columns?: number
    class?: HTMLAttributes["class"]
  }>(),
  { variant: "filled" },
)

provide(STAT_STRIP, { variant: toRef(props, "variant") })

/** 7rem and the gap (gap-2), in px at the kit's 16px rem. */
const MIN = 112
const GAP = 8

const root = ref<HTMLElement | null>(null)
const width = ref(0)
const count = ref(0)
let observer: ResizeObserver | null = null
const measure = () => {
  const element = root.value
  if (!element) return
  width.value = element.clientWidth
  count.value = element.children.length
}
onMounted(() => {
  measure()
  if (typeof ResizeObserver === "undefined" || !root.value) return
  observer = new ResizeObserver(measure)
  observer.observe(root.value)
})
onUpdated(measure)
onBeforeUnmount(() => observer?.disconnect())

// Until it is measured (and where nothing measures), the browser fits as many tiles as it can.
const template = computed(() => {
  if (props.columns) return `repeat(${props.columns},minmax(0,1fr))`
  if (width.value === 0 || count.value === 0) return "repeat(auto-fit,minmax(7rem,1fr))"
  return `repeat(${stripColumns(count.value, width.value, MIN, GAP)},minmax(0,1fr))`
})
</script>

<template>
  <dl ref="root" data-slot="stat-strip" :data-variant="variant" :class="cn('m-0 grid gap-2', props.class)" :style="{ gridTemplateColumns: template }">
    <slot />
  </dl>
</template>
