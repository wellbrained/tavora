<script setup lang="ts">
// A line chart for one or two lines over time: game time (m:ss) or dates on the bottom, a value axis on the left, and
// the values beside the point you hover or reach with the arrow keys (the kit's tooltip, next to the point, never at the
// pointer). Drawn as SVG in theme colours, as wide as its container and `height` tall; no legend, zoom or animation.
// A date axis is local time. Lines are told apart by their name in the tooltip and by the dashes of the second one, so
// colour is never the only cue; if people need to know which is which at a glance, put your own words beside the chart.
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue"
import { cn } from "../../../lib/utils"
import Tooltip from "../../tooltip/Tooltip"
import TooltipRows from "../../tooltip/TooltipRows"
import type { TooltipRect } from "../../tooltip"
import EmptyState from "../empty-state/EmptyState.vue"
import { allX, dateHeading, dateTickLabel, dateTicks, drawable, formatTime, nearestX, niceTicks, pointAt, stepX, timeTicks } from "./chart"
import type { LineChartSeries } from "./chart"

const props = withDefaults(
  defineProps<{
    /** One or two lines; more are left out. */
    series: readonly LineChartSeries[]
    /** What the chart shows, for screen readers. */
    label: string
    /** `time`: x is seconds of game time, written m:ss. `date`: x is milliseconds since 1970 (`Date.getTime()`). */
    axis?: "time" | "date"
    /** Height in pixels. */
    height?: number
    /** Fixed ends of the value axis, such as `0`. Without them the axis fits the values. Values outside are drawn at the edge. */
    yMin?: number
    yMax?: number
    /** How a value is written on the axis and in the tooltip. */
    formatY?: (y: number) => string
    /** How an x is written in the tooltip's title (the axis labels follow `axis`). */
    formatX?: (x: number) => string
    /** For dates and numbers; the language shown now when left out. */
    locale?: string
    /** Shown instead of the chart when no line has a point. */
    emptyTitle?: string
    emptyDescription?: string
    class?: string
  }>(),
  { axis: "time", height: 180 },
)

const TOP = 8
const BOTTOM = 28
const RIGHT = 12
/** About the width of one digit at the axis text size. */
const CHAR = 7

const root = ref<HTMLElement | null>(null)
const width = ref(0)
let observer: ResizeObserver | null = null
onMounted(() => {
  const element = root.value
  if (!element) return
  width.value = element.clientWidth
  if (typeof ResizeObserver === "undefined") return
  observer = new ResizeObserver(() => {
    width.value = element.clientWidth
  })
  observer.observe(element)
})
onBeforeUnmount(() => observer?.disconnect())

const lines = computed(() =>
  props.series.slice(0, 2).map((line, index) => ({
    label: line.label,
    color: line.color ?? (index === 0 ? "primary" : "muted-foreground"),
    dashed: line.dashed ?? index === 1,
    points: drawable(line.points),
  })),
)
const empty = computed(() => lines.value.every((line) => line.points.length === 0))
const locale = computed(() => props.locale ?? (typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined))

const plotHeight = computed(() => Math.max(1, props.height - TOP - BOTTOM))

const yAxis = computed(() => {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const line of lines.value) {
    for (const point of line.points) {
      if (point.y < low) low = point.y
      if (point.y > high) high = point.y
    }
  }
  if (!Number.isFinite(low)) {
    low = 0
    high = 1
  }
  const nice = niceTicks(props.yMin ?? low, props.yMax ?? high, Math.max(2, Math.floor(plotHeight.value / 36)))
  const min = props.yMin ?? nice.min
  const max = props.yMax ?? nice.max
  const ticks = nice.ticks.filter((tick) => tick >= min && tick <= max)
  const write = props.formatY ?? ((y: number) => y.toLocaleString(locale.value))
  return { min, max, ticks: ticks.map((value) => ({ value, text: write(value) })), write }
})

const left = computed(() => Math.max(24, ...yAxis.value.ticks.map((tick) => tick.text.length * CHAR)) + 12)
const plotWidth = computed(() => Math.max(1, width.value - left.value - RIGHT))

const xRange = computed(() => {
  const xs = allX(lines.value.map((line) => line.points))
  if (xs.length === 0) return { min: 0, max: 1 }
  let min = xs[0]!
  let max = xs[xs.length - 1]!
  if (min === max) {
    const pad = props.axis === "time" ? 30 : 12 * 3_600_000
    min = props.axis === "time" ? Math.max(0, min - pad) : min - pad
    max += pad
  }
  return { min, max }
})

const xTicks = computed(() => {
  const count = Math.max(2, Math.floor(plotWidth.value / 72))
  const { min, max } = xRange.value
  if (props.axis === "date") {
    const { ticks, unit } = dateTicks(min, max, count)
    const write = dateTickLabel(unit, locale.value)
    return ticks.map((value) => ({ value, text: write(value) }))
  }
  return timeTicks(min, max, count).map((value) => ({ value, text: formatTime(value) }))
})

const px = (x: number) => left.value + ((x - xRange.value.min) / (xRange.value.max - xRange.value.min || 1)) * plotWidth.value
const py = (y: number) => {
  const { min, max } = yAxis.value
  const clamped = Math.min(max, Math.max(min, y))
  return TOP + (1 - (clamped - min) / (max - min || 1)) * plotHeight.value
}
const dx = (x: number) => px(x).toFixed(1)
const dy = (y: number) => py(y).toFixed(1)

const paths = computed(() =>
  lines.value.map((line) => ({ ...line, d: line.points.length < 2 ? "" : line.points.map((p, index) => `${index === 0 ? "M" : "L"}${dx(p.x)} ${dy(p.y)}`).join(" ") })),
)
/** A tick label is centred under its tick unless that would push it out of the chart. */
const xLabels = computed(() =>
  xTicks.value.map((tick) => {
    const x = px(tick.value)
    const half = (tick.text.length * CHAR) / 2
    return { ...tick, x, anchor: x - half < 0 ? "start" : x + half > width.value ? "end" : "middle" }
  }),
)

// The point under the pointer or reached by the keys: the x of the nearest point of any line. A line without a point at
// exactly that x is left out of the tooltip rather than shown with a made-up value.
const activeX = ref<number | null>(null)
const anchor = ref<TooltipRect | null>(null)
const tipId = useId()
const heading = computed(() => {
  if (activeX.value === null) return ""
  if (props.formatX) return props.formatX(activeX.value)
  return props.axis === "date" ? dateHeading(locale.value)(activeX.value) : formatTime(activeX.value)
})
const active = computed(() => {
  const x = activeX.value
  if (x === null) return []
  return lines.value.flatMap((line) => {
    const point = pointAt(line.points, x)
    return point ? [{ line, point }] : []
  })
})
const open = computed(() => active.value.length > 0 && anchor.value !== null)
const rows = computed(() => active.value.map(({ line, point }) => ({ label: line.label, value: yAxis.value.write(point.y) })))

function show(x: number | null) {
  if (x === activeX.value) return
  activeX.value = x
  const element = root.value
  const marks = x === null ? [] : lines.value.flatMap((line) => (pointAt(line.points, x) ? [py(pointAt(line.points, x)!.y)] : []))
  if (!element || marks.length === 0) {
    activeX.value = null
    anchor.value = null
    return
  }
  // The box of the marker(s) on the screen: the card opens beside it with a small gap.
  const box = element.getBoundingClientRect()
  const centre = box.left + px(x!)
  anchor.value = { left: centre - 6, right: centre + 6, top: box.top + Math.min(...marks) - 6, bottom: box.top + Math.max(...marks) + 6 }
}
const hide = () => show(null)
// New data or a new size: the tooltip stays on its point if the point is still there, now where it is drawn, else it goes.
watch([width, lines, () => props.height, () => props.axis], () => {
  const x = activeX.value
  if (x === null) return
  activeX.value = null
  show(x)
})

const xsAll = computed(() => allX(lines.value.map((line) => line.points)))

function onPointer(event: PointerEvent) {
  const element = root.value
  if (!element || empty.value || width.value === 0) return
  const x = event.clientX - element.getBoundingClientRect().left
  if (x < left.value - 8 || x > left.value + plotWidth.value + 8) return hide()
  const { min, max } = xRange.value
  show(nearestX(lines.value.map((line) => line.points), min + ((x - left.value) / plotWidth.value) * (max - min)))
}
function onLeave(event: PointerEvent) {
  // A finger that lifts leaves the tooltip until the next tap or until the chart loses focus.
  if (event.pointerType !== "touch") hide()
}
function onKey(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const xs = xsAll.value
  const next =
    event.key === "ArrowRight" ? stepX(xs, activeX.value, 1)
    : event.key === "ArrowLeft" ? stepX(xs, activeX.value, -1)
    : event.key === "Home" ? (xs[0] ?? null)
    : event.key === "End" ? (xs[xs.length - 1] ?? null)
    : undefined
  if (event.key === "Escape" && activeX.value !== null) {
    event.preventDefault()
    return hide()
  }
  if (next === undefined) return
  event.preventDefault()
  show(next)
}
</script>

<template>
  <div
    ref="root"
    data-slot="line-chart"
    role="group"
    :aria-label="label"
    :aria-describedby="open ? tipId : undefined"
    :tabindex="empty ? undefined : 0"
    :class="cn('border-transparent relative w-full touch-pan-y rounded-md border outline-none select-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3', props.class)"
    :style="{ height: `${height}px` }"
    @pointermove="onPointer"
    @pointerdown="onPointer"
    @pointerleave="onLeave"
    @keydown="onKey"
    @blur="hide"
  >
    <EmptyState v-if="empty && emptyTitle" :title="emptyTitle" :description="emptyDescription" class="h-full justify-center py-0" />
    <svg v-else-if="width > 0" :width="width" :height="height" class="block" aria-hidden="true">
      <g v-for="tick in yAxis.ticks" :key="`y${tick.value}`">
        <line :x1="left" :x2="left + plotWidth" :y1="dy(tick.value)" :y2="dy(tick.value)" style="stroke: var(--border)" shape-rendering="crispEdges" />
        <text :x="left - 8" :y="dy(tick.value)" dy="0.32em" text-anchor="end" class="fill-muted-foreground text-xs tabular-nums">{{ tick.text }}</text>
      </g>
      <text v-for="tick in xLabels" :key="`x${tick.value}`" :x="tick.x" :y="height - 8" :text-anchor="tick.anchor" class="fill-muted-foreground text-xs tabular-nums">{{ tick.text }}</text>
      <template v-if="!empty">
        <path
          v-for="(line, index) in paths"
          :key="index"
          :d="line.d"
          fill="none"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
          :stroke-dasharray="line.dashed ? '6 4' : undefined"
          :style="{ stroke: `var(--${line.color})` }"
        />
        <!-- A line with a single point has no line to show: its point stays. -->
        <template v-for="(line, index) in lines" :key="`one${index}`">
          <circle v-if="line.points.length === 1" :cx="dx(line.points[0]!.x)" :cy="dy(line.points[0]!.y)" r="3.5" :style="{ fill: `var(--${line.color})` }" />
        </template>
      </template>
      <g v-if="open" pointer-events="none">
        <line :x1="px(activeX!)" :x2="px(activeX!)" :y1="TOP" :y2="TOP + plotHeight" stroke-opacity="0.5" shape-rendering="crispEdges" style="stroke: var(--muted-foreground)" />
        <circle v-for="({ line, point }, index) in active" :key="index":cx="dx(point.x)" :cy="dy(point.y)" r="4" stroke-width="2" :style="{ fill: `var(--${line.color})`, stroke: 'var(--card)' }" />
      </g>
    </svg>
    <Tooltip :open="open" :anchor="anchor ?? undefined" side="top" :title="heading" :id="tipId" @dismiss="hide">
      <TooltipRows :rows="rows" />
    </Tooltip>
  </div>
</template>
