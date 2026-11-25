<script setup lang="ts">
// One row of numbers as bars: a distribution (games by guesses), a count per day. `horizontal` puts each bar in a
// muted track with its label before it and its count after; `vertical` stands the bars on a value axis with their
// labels under them. The chart is one stop for Tab: the arrow keys, Home and End go from bar to bar, and each bar's
// values show in the kit tooltip next to it (never at the pointer). A highlighted bar is drawn in the full colour
// with a bold label, so it doesn't rely on colour alone. One series only; no stacked or grouped bars.
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue"
import { cn } from "../../../lib/utils"
import Tooltip from "../../tooltip/Tooltip"
import TooltipRows from "../../tooltip/TooltipRows"
import type { TooltipRect } from "../../tooltip"
import type { TooltipRow } from "../../tooltip/rows"
import EmptyState from "../empty-state/EmptyState.vue"
import { niceTicks } from "../line-chart/chart"
import { uiLocale, uiText, writeNumber } from "../text"
import { drawable, fill, scaleMax, shareOf, stepBar, type BarChartBar } from "./bars"

const props = withDefaults(
  defineProps<{
    bars: readonly BarChartBar[]
    /** What the chart shows, for screen readers: "Games by guesses". */
    label: string
    orientation?: "horizontal" | "vertical"
    /** The name of a value in the tooltip ("Games"); the chart's `label` when left out. */
    valueLabel?: string
    /** How a value is written beside a bar, on the axis and in the tooltip; the language's numbers when left out. */
    format?: (value: number) => string
    /** The top of the scale. Without it the scale fits the biggest bar. */
    max?: number
    /** Adds each bar's part of the total to its tooltip ("39%"). */
    showShare?: boolean
    /** Height in pixels of a vertical chart, labels included. */
    height?: number
    /** Shown instead of the chart when there are no bars. */
    emptyTitle?: string
    emptyDescription?: string
    class?: string
  }>(),
  { orientation: "horizontal", height: 180 },
)

const write = (value: number) => (props.format ? props.format(value) : writeNumber(value, uiLocale.value))
const empty = computed(() => props.bars.length === 0)
const vertical = computed(() => props.orientation === "vertical")

// Vertical: a value axis with round steps, about one every 36 px. Horizontal: the scale is the biggest bar (or `max`).
const LABELS = 22
const CHAR = 7
const plotHeight = computed(() => Math.max(1, props.height - LABELS - 8))
const axis = computed(() => {
  const nice = niceTicks(0, scaleMax(props.bars, props.max), Math.max(2, Math.floor(plotHeight.value / 36)))
  const top = props.max ?? nice.max
  return { top, ticks: nice.ticks.filter((tick) => tick >= 0 && tick <= top).map((value) => ({ value, text: write(value) })) }
})
const top = computed(() => (vertical.value ? axis.value.top : scaleMax(props.bars, props.max)))
const axisWidth = computed(() => Math.max(16, ...axis.value.ticks.map((tick) => tick.text.length * CHAR)))
/** The chart's width, for how many labels fit under vertical bars. */
const width = ref(0)
/** Every how many bars a vertical label shows: all of them when they fit, else every second, third… */
const labelStep = computed(() => {
  const slot = (width.value - axisWidth.value - 6) / Math.max(1, props.bars.length)
  const needed = Math.max(1, ...props.bars.map((bar) => bar.label.length)) * CHAR + 4
  return width.value > 0 && slot > 0 ? Math.max(1, Math.ceil(needed / slot)) : 1
})
const shown = computed(() =>
  props.bars.map((bar) => ({ ...bar, part: fill(bar.value, top.value), text: write(drawable(bar.value)) })),
)

// The bar under the pointer or reached by the keys, and where its tooltip goes.
const root = ref<HTMLElement | null>(null)
const active = ref<number | null>(null)
const anchor = ref<TooltipRect | null>(null)
const tipId = useId()
const open = computed(() => active.value !== null && anchor.value !== null)
const current = computed(() => (active.value === null ? null : (props.bars[active.value] ?? null)))
const rows = computed<TooltipRow[]>(() => {
  const bar = current.value
  if (!bar) return []
  const share = new Intl.NumberFormat(uiLocale.value, { style: "percent", maximumFractionDigits: 0 }).format(shareOf(props.bars, bar.value))
  return [
    { label: props.valueLabel ?? props.label, value: write(drawable(bar.value)) },
    ...(props.showShare ? [{ label: uiText.value.barShare, value: share }] : []),
    ...(bar.tooltip ?? []),
  ]
})

function show(index: number | null) {
  const element = root.value
  const mark = index === null ? null : element?.querySelector<HTMLElement>(`[data-bar="${index}"]`)
  if (!mark) {
    active.value = null
    anchor.value = null
    return
  }
  active.value = index
  // The bar's own box, so the card sits over the bar and not the middle of the track; an empty or tiny bar counts as
  // its first 8 px (horizontal) or its foot (vertical), so the card still has a place.
  const filled = vertical.value ? mark : ((mark.firstElementChild as HTMLElement | null) ?? mark)
  const box = filled.getBoundingClientRect()
  anchor.value = { left: box.left, right: Math.max(box.right, box.left + 8), top: box.top, bottom: box.bottom }
}
const hide = () => show(null)
// New bars or a new orientation: the tooltip follows its bar if it is still there.
watch([() => props.bars, () => props.orientation, () => props.height], () => {
  const index = active.value
  if (index === null) return
  requestAnimationFrame(() => show(index < props.bars.length ? index : null))
})
let observer: ResizeObserver | null = null
onMounted(() => {
  if (typeof ResizeObserver === "undefined" || !root.value) return
  width.value = root.value.clientWidth
  observer = new ResizeObserver(() => {
    width.value = root.value?.clientWidth ?? 0
    if (active.value !== null) show(active.value)
  })
  observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

function onPointer(event: PointerEvent) {
  const row = (event.target as Element | null)?.closest<HTMLElement>("[data-row]")
  if (!row) return hide()
  const index = Number(row.dataset.row)
  if (index !== active.value) show(index)
}
function onLeave(event: PointerEvent) {
  // A finger that lifts leaves the tooltip until the next tap or until the chart loses focus.
  if (event.pointerType !== "touch") hide()
}
function onKey(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key === "Escape" && active.value !== null) {
    event.preventDefault()
    return hide()
  }
  const next = stepBar(props.bars.length, active.value, event.key)
  if (next === undefined) return
  event.preventDefault()
  show(next)
}

const barColour = (highlight?: boolean) => (highlight ? "bg-primary" : "bg-primary/55")
/** A bar's label: bold in the text colour when highlighted. */
const labelColour = (highlight?: boolean) => (highlight ? "text-foreground font-semibold" : "text-muted-foreground")
/** The ring on the bar the keys reached, only while the chart has the keyboard focus. */
const ring = "group-focus-visible:data-[active]:ring-ring group-focus-visible:data-[active]:ring-2 group-focus-visible:data-[active]:ring-offset-2 ring-offset-card"
</script>

<template>
  <div
    ref="root"
    data-slot="bar-chart"
    :data-orientation="orientation"
    role="group"
    :aria-label="label"
    :aria-describedby="open ? tipId : undefined"
    :tabindex="empty ? undefined : 0"
    :class="cn('group relative w-full touch-pan-y rounded-md border border-transparent outline-none select-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3', props.class)"
    @pointermove="onPointer"
    @pointerdown="onPointer"
    @pointerleave="onLeave"
    @keydown="onKey"
    @blur="hide"
  >
    <EmptyState v-if="empty && emptyTitle" :title="emptyTitle" :description="emptyDescription" class="justify-center py-6" :style="vertical ? { height: `${height}px` } : undefined" />
    <!-- Horizontal: label, track with its bar, count; one grid so the tracks start and end together. -->
    <div v-else-if="!vertical" role="list" class="grid grid-cols-[fit-content(40%)_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-xs tabular-nums">
      <div v-for="(bar, index) in shown" :key="index" role="listitem" :data-row="index" class="contents">
        <span :class="['truncate text-right', labelColour(bar.highlight)]">{{ bar.label }}</span>
        <span :data-bar="index" :data-active="active === index ? '' : undefined" :class="['bg-muted/70 block h-4 overflow-hidden rounded-sm', ring]">
          <span :class="['block h-full rounded-sm', barColour(bar.highlight)]" :style="{ width: `${bar.part * 100}%` }" />
        </span>
        <span :class="['text-foreground min-w-6', bar.highlight && 'font-semibold']"><span class="sr-only">: </span>{{ bar.text }}</span>
      </div>
    </div>
    <!-- Vertical: the value axis, then the bars on their grid lines, their labels under them. -->
    <div v-else class="grid text-xs tabular-nums" :style="{ height: `${height}px`, gridTemplateColumns: `${axisWidth}px minmax(0,1fr)`, columnGap: '6px' }">
      <div class="text-muted-foreground relative" :style="{ height: `${plotHeight}px`, marginTop: '8px' }" aria-hidden="true">
        <span v-for="tick in axis.ticks" :key="tick.value" class="absolute right-0 translate-y-1/2 leading-none" :style="{ bottom: `${(tick.value / axis.top) * 100}%` }">{{ tick.text }}</span>
      </div>
      <div class="flex min-w-0 flex-col" :style="{ marginTop: '8px' }">
        <div class="border-border relative flex items-end gap-[clamp(2px,2%,8px)] border-b" :style="{ height: `${plotHeight}px` }">
          <span v-for="tick in axis.ticks" :key="tick.value" class="border-border/60 pointer-events-none absolute inset-x-0 border-t" :style="{ bottom: `${(tick.value / axis.top) * 100}%` }" aria-hidden="true" />
          <div role="list" class="contents">
            <div v-for="(bar, index) in shown" :key="index" role="listitem" :data-row="index" class="relative flex h-full min-w-0 flex-1 items-end">
              <span
                :data-bar="index"
                :data-active="active === index ? '' : undefined"
                :class="['block w-full rounded-t-sm', bar.part > 0 ? barColour(bar.highlight) : '', ring]"
                :style="{ height: bar.part > 0 ? `${bar.part * 100}%` : '1px' }"
              />
              <span class="sr-only">{{ bar.label }}: {{ bar.text }}</span>
            </div>
          </div>
        </div>
        <div class="flex gap-[clamp(2px,2%,8px)] pt-1" aria-hidden="true">
          <span v-for="(bar, index) in shown" :key="index" :class="['min-w-0 flex-1 text-center whitespace-nowrap', labelColour(bar.highlight)]">{{ index % labelStep === 0 || bar.highlight ? bar.label : "" }}</span>
        </div>
      </div>
    </div>
    <Tooltip :open="open" :anchor="anchor ?? undefined" :side="vertical ? 'right' : 'top'" :title="current?.title ?? current?.label ?? ''" :id="tipId" @dismiss="hide">
      <TooltipRows :rows="rows" />
    </Tooltip>
  </div>
</template>
