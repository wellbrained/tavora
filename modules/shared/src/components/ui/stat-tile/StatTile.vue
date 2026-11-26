<script setup lang="ts">
// One number with what it is: a big value, a caption under it, and a short line under that (a change, a hint). In a
// StatStrip the tiles share a row; alone it is a small `<dl>` of its own. The value never gets cut: if it doesn't fit,
// it drops one text size. The hint stays on one line, cut with "…", its full text in a title hint.
import type { HTMLAttributes } from "vue"
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { cn } from "../../../lib/utils"
import { trendMark, trendWord, type TooltipTrend } from "../../tooltip/rows"
import CountTo from "../count-to/CountTo.vue"
import { uiLocale, uiText, writeNumber } from "../text"
import { STAT_STRIP, type StatTileVariant } from "./context"
import "../hover-row/hover-row.css"

const props = defineProps<{
  /** A number is written in the language shown (1,240 / 1.240); text such as "3:42" shows as it is. */
  value: number | string
  /** What the value is: "Played", "Win rate". */
  label: string
  /** Small, after the value: "%", "min". */
  unit?: string
  /** Colours the hint (or, without one, a mark after the value) green or red, with an arrow. */
  trend?: TooltipTrend
  /** One short line under the label, such as "+4 vs last week". */
  hint?: string
  /** Counts to a new number instead of jumping (a number only). */
  animate?: boolean
  /** Writes a big number short (12.3M), the full number in a title hint. */
  compact?: boolean
  /** Writes a number your way instead. */
  format?: (value: number) => string
  /** Outside a StatStrip; inside one the strip sets it. */
  variant?: StatTileVariant
  /**
   * Shows a card on hover or keyboard focus (bind `tip.on(card)` on the tile): it lights up like a ghost Button, takes
   * the focus ring and is in the Tab order, but doesn't do anything on a click (the HoverRow look, inside the tile).
   */
  hoverable?: boolean
  class?: HTMLAttributes["class"]
}>()

const strip = inject(STAT_STRIP, null)
const variant = computed(() => props.variant ?? strip?.variant.value ?? "filled")

const write = (value: number) => (props.format ? props.format(value) : writeNumber(value, uiLocale.value, props.compact))
// No value yet (empty text, or a number that isn't one): a dash, read out as "No data yet".
const missing = computed(() => props.value == null || props.value === "" || (typeof props.value === "number" && !Number.isFinite(props.value)))
const text = computed(() => (missing.value ? "—" : typeof props.value === "number" ? write(props.value) : props.value))
const full = computed(() => (props.compact && typeof props.value === "number" && !props.format ? writeNumber(props.value, uiLocale.value) : undefined))

// The value is never cut. An invisible copy at the full size (20px) gives its natural width: wider than the tile, the
// value drops one size (16px); wider still, it wraps. It grows back as soon as it fits again.
const valueBox = ref<HTMLElement | null>(null)
const ghost = ref<HTMLElement | null>(null)
const hintBox = ref<HTMLElement | null>(null)
const small = ref(false)
const wrap = ref(false)
/** The hint is cut: its full text goes in a title hint. */
const cut = ref(false)
let observer: ResizeObserver | null = null
const fit = () => {
  const box = valueBox.value
  if (box && ghost.value && box.clientWidth > 0) {
    const needed = ghost.value.getBoundingClientRect().width
    small.value = needed > box.clientWidth + 0.5
    wrap.value = needed * 0.8 > box.clientWidth + 0.5
  }
  const hint = hintBox.value
  cut.value = !!hint && hint.scrollWidth > hint.clientWidth + 0.5
}
onMounted(() => {
  fit()
  if (typeof ResizeObserver === "undefined") return
  observer = new ResizeObserver(fit)
  for (const element of [valueBox.value, ghost.value]) if (element) observer.observe(element)
})
onBeforeUnmount(() => observer?.disconnect())
watch(() => props.hint, () => queueMicrotask(fit), { flush: "post" })

const tile = computed(() =>
  cn(
    "relative flex min-w-0 flex-col gap-0.5 overflow-hidden rounded-md px-3 py-2",
    variant.value === "outlined" ? "border-border bg-background border" : "bg-muted/60",
    props.hoverable && "tavora-hover-row [--hover-row-inset:0]",
    props.class,
  ),
)
/** The trend's arrow, and its word for screen readers. */
const TrendArrow = (p: { trend?: TooltipTrend }) => trendMark(p.trend)
const TrendWord = (p: { trend?: TooltipTrend }) => trendWord(p.trend)
const trendColour = computed(() => (props.trend === "better" ? "text-success" : props.trend === "worse" ? "text-destructive" : ""))
</script>

<template>
  <component :is="strip ? 'div' : 'dl'" data-slot="stat-tile" :data-variant="variant" :data-trend="trend" :class="[tile, !strip && 'm-0']" :tabindex="hoverable ? 0 : undefined">
    <dt class="text-muted-foreground order-2 truncate text-xs">{{ label }}</dt>
    <dd
      ref="valueBox"
      class="order-1 m-0 font-semibold tabular-nums"
      :class="[small ? 'text-lg leading-[26px]' : 'text-xl', wrap ? '[overflow-wrap:anywhere]' : 'whitespace-nowrap']"
      :title="full"
    >
      <template v-if="missing"><span class="text-muted-foreground" aria-hidden="true">{{ text }}</span><span class="sr-only">{{ uiText.noData }}</span></template>
      <CountTo v-else-if="animate && typeof value === 'number'" :value="value" :format="write" /><template v-else>{{ text }}</template>
      <span v-if="unit && !missing" class="text-muted-foreground ml-0.5 text-sm font-medium">{{ unit }}</span>
      <span v-if="trend && !hint" :class="['ml-1 text-sm', trendColour]"><TrendArrow :trend="trend" /><TrendWord :trend="trend" /></span>
    </dd>
    <!-- The value at its full size, out of sight, to measure what it needs. -->
    <span ref="ghost" aria-hidden="true" class="pointer-events-none invisible absolute top-0 left-0 text-xl font-semibold whitespace-nowrap tabular-nums"
      >{{ text }}<span v-if="unit" class="ml-0.5 text-sm font-medium">{{ unit }}</span><span v-if="trend && !hint" class="ml-1 inline-block w-[1.5em] text-sm"
    /></span>
    <dd v-if="hint" ref="hintBox" :class="['order-3 m-0 truncate text-xs', trendColour]" :title="cut ? hint : undefined"><TrendArrow :trend="trend" />{{ hint }}<TrendWord :trend="trend" /></dd>
  </component>
</template>
