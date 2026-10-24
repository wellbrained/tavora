<script setup lang="ts">
// A viewport that pans and zooms what is inside it. Drag pans, Ctrl + wheel or a pinch
// zooms, a plain wheel keeps scrolling the page (with a short hint), and the buttons in
// the corner zoom in, out and fit. With focus: + and - zoom, 0 fits, arrow keys pan.
// The content is fitted when it first shows and whenever its size changes. With autoFit off
// only when it first shows, so content that grows (a box dragged past the edge) keeps the view.
// With fit "width" the content fills the width and is read top to bottom like a page: a
// plain wheel scrolls it, and it is fitted again when the pane's width changes.
// A parent can read `view`, put a saved one back with setView() and show an area with showArea().
import type { HTMLAttributes } from "vue"
import { Maximize, Minus, Plus } from "@lucide/vue"
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { cn } from "../../../lib/utils"
import { Button } from "../button"
import { uiText } from "../text"
import { areaView, clampPan, clampZoom, fitView, type Size, type ZoomAlign, type ZoomArea, type ZoomFit, zoomAt, type ZoomView } from "./view"

const props = withDefaults(defineProps<{
  /** Smallest and largest zoom, 1 = 100 %. */
  minZoom?: number
  maxZoom?: number
  /** Fitting never goes below this zoom; bigger content then starts at the side `align` names. Defaults to minZoom. */
  fitFloor?: number
  align?: ZoomAlign
  /** Fit the whole content, or only its width (a plain wheel then scrolls it). */
  fit?: ZoomFit
  /** Fit again whenever the content changes size. Off: only the first show fits; call fit() when the content is new. */
  autoFit?: boolean
  /** What the pane shows, for screen readers. */
  label?: string
  class?: HTMLAttributes["class"]
}>(), {
  minZoom: 0.25,
  maxZoom: 2,
  align: "center",
  fit: "whole",
  autoFit: true,
})

/** One press of a button or key. */
const STEP = 1.25
/** How far an arrow key pans, in pixels. */
const PAN_STEP = 48
/** A pointer must move this far before it pans, so clicks inside still work. */
const DRAG_START = 4
/** Elements a pan never starts on. */
const INTERACTIVE = "button, a, input, select, textarea, [role=button], [role=combobox], [contenteditable=true], [data-zoom-pane-ignore]"

const pane = ref<HTMLElement>()
const content = ref<HTMLElement>()
const view = ref<ZoomView>({ x: 0, y: 0, zoom: 1 })
const dragging = ref(false)
const hint = ref(false)

const limits = computed(() => ({ min: props.minZoom, max: props.maxZoom }))
const paneSize = ref<Size>({ width: 0, height: 0 })
const contentSize = ref<Size>({ width: 0, height: 0 })
const transform = computed(() => `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.zoom})`)

function fit() {
  view.value = fitView(paneSize.value, contentSize.value, limits.value, props.fitFloor ?? props.minZoom, props.align, props.fit)
}

const middle = () => ({ x: paneSize.value.width / 2, y: paneSize.value.height / 2 })
function zoomBy(factor: number, at = middle()) {
  view.value = zoomAt(view.value, factor, at, limits.value, paneSize.value, contentSize.value)
}
function panBy(dx: number, dy: number, from = view.value) {
  view.value = clampPan({ ...from, x: from.x + dx, y: from.y + dy }, paneSize.value, contentSize.value)
}
/**
 * The content is about to be drawn shifted by dx, dy (content pixels), for example because it grew to the
 * left: moves the view along so nothing jumps. Not clamped; the next size check clamps with the new size.
 */
function moveOrigin(dx: number, dy: number) {
  view.value = { ...view.value, x: view.value.x - dx * view.value.zoom, y: view.value.y - dy * view.value.zoom }
}
/** The view a parent asked for before the pane was measured, worked out once it is; it replaces the first fit. */
let pendingView: (() => ZoomView) | undefined
const measured = () => paneSize.value.width > 0 && paneSize.value.height > 0 && contentSize.value.width > 0 && contentSize.value.height > 0
function applyView(next: ZoomView) {
  view.value = clampPan({ ...next, zoom: clampZoom(next.zoom, limits.value) }, paneSize.value, contentSize.value)
}
function whenMeasured(next: () => ZoomView) {
  if (measured()) applyView(next())
  else pendingView = next
}
/** Sets the view (for example one saved earlier). Zoom and pan are kept in reach. Before the first show it is used instead of the first fit. */
function setView(next: ZoomView) {
  const copy = { ...next }
  whenMeasured(() => copy)
}
/**
 * Zooms and pans so `area` (content pixels at zoom 1) fills the pane, centred, with `padding` pixels around it.
 * Before the first show it is used instead of the first fit.
 */
function showArea(area: ZoomArea, options: { padding?: number } = {}) {
  const copy = { ...area }
  whenMeasured(() => areaView(paneSize.value, copy, limits.value, options.padding ?? 24))
}
const zoomIn = () => zoomBy(STEP)
const zoomOut = () => zoomBy(1 / STEP)

function local(event: { clientX: number, clientY: number }) {
  const box = pane.value!.getBoundingClientRect()
  return { x: event.clientX - box.left, y: event.clientY - box.top }
}

// Pointers: one pans, two (touch) pinch.
const pointers = new Map<number, { x: number, y: number }>()
let drag: { start: { x: number, y: number }, from: ZoomView, id: number } | null = null
let pinch: { distance: number, middle: { x: number, y: number }, from: ZoomView } | null = null
/** A pan just ended: the click that follows it does nothing. */
let swallowClick = false

/** Keeps getting the pointer outside the pane; a pointer that is already gone throws, which is harmless. */
function capture(id: number) {
  try {
    pane.value!.setPointerCapture(id)
  }
  catch {}
}

const distance = (a: { x: number, y: number }, b: { x: number, y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

function onPointerDown(event: PointerEvent) {
  if (event.pointerType === "mouse" && event.button !== 0) return
  if (event.target instanceof Element && event.target.closest(INTERACTIVE) && event.pointerType === "mouse") return
  pointers.set(event.pointerId, local(event))
  if (pointers.size === 1) {
    drag = { start: local(event), from: view.value, id: event.pointerId }
  }
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number, y: number }, { x: number, y: number }]
    drag = null
    pinch = { distance: distance(a, b), middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, from: view.value }
    capture(event.pointerId)
  }
}

function onPointerMove(event: PointerEvent) {
  if (!pointers.has(event.pointerId)) return
  const at = local(event)
  pointers.set(event.pointerId, at)
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number, y: number }, { x: number, y: number }]
    const middleNow = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const zoomed = zoomAt(pinch.from, distance(a, b) / pinch.distance, pinch.middle, limits.value, paneSize.value, contentSize.value)
    panBy(middleNow.x - pinch.middle.x, middleNow.y - pinch.middle.y, zoomed)
    return
  }
  if (!drag || drag.id !== event.pointerId) return
  const dx = at.x - drag.start.x
  const dy = at.y - drag.start.y
  if (!dragging.value) {
    if (Math.hypot(dx, dy) < DRAG_START) return
    dragging.value = true
    capture(event.pointerId)
  }
  panBy(dx, dy, drag.from)
}

function onPointerUp(event: PointerEvent) {
  pointers.delete(event.pointerId)
  if (pointers.size < 2) pinch = null
  if (drag?.id === event.pointerId) {
    if (dragging.value) {
      // The click comes right after pointerup, if at all; never keep it for a later one.
      swallowClick = true
      setTimeout(() => (swallowClick = false))
    }
    drag = null
    dragging.value = false
  }
}

function onClickCapture(event: MouseEvent) {
  if (!swallowClick) return
  swallowClick = false
  event.stopPropagation()
  event.preventDefault()
}

let hintTimer: ReturnType<typeof setTimeout> | undefined
function onWheel(event: WheelEvent) {
  if (!event.ctrlKey && props.fit === "width") {
    // Read like a page: the wheel scrolls, Shift + wheel goes sideways.
    event.preventDefault()
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1
    const sideways = event.shiftKey && !event.deltaX
    panBy(-(sideways ? event.deltaY : event.deltaX) * lines, sideways ? 0 : -event.deltaY * lines)
    return
  }
  if (!event.ctrlKey) {
    // A plain wheel scrolls the page; say how to zoom instead.
    hint.value = true
    clearTimeout(hintTimer)
    hintTimer = setTimeout(() => (hint.value = false), 1500)
    return
  }
  event.preventDefault()
  hint.value = false
  const speed = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 0.05 : 0.002
  zoomBy(Math.exp(-event.deltaY * speed), local(event))
}

function onKeyDown(event: KeyboardEvent) {
  if (event.target !== pane.value || event.ctrlKey || event.altKey || event.metaKey) return
  const actions: Record<string, () => void> = {
    "+": zoomIn,
    "=": zoomIn,
    "-": zoomOut,
    "0": fit,
    "ArrowLeft": () => panBy(PAN_STEP, 0),
    "ArrowRight": () => panBy(-PAN_STEP, 0),
    "ArrowUp": () => panBy(0, PAN_STEP),
    "ArrowDown": () => panBy(0, -PAN_STEP),
  }
  const action = actions[event.key]
  if (!action) return
  event.preventDefault()
  action()
}

let observer: ResizeObserver | undefined
onMounted(() => {
  // The wheel listener must not be passive, so Ctrl + wheel can stop the page from zooming.
  pane.value!.addEventListener("wheel", onWheel, { passive: false })
  observer = new ResizeObserver(() => {
    const nextPane = { width: pane.value!.clientWidth, height: pane.value!.clientHeight }
    // offsetWidth is the size before the transform, so zooming does not change it.
    const nextContent = { width: content.value!.offsetWidth, height: content.value!.offsetHeight }
    const contentChanged = nextContent.width !== contentSize.value.width || nextContent.height !== contentSize.value.height
    const paneWasEmpty = paneSize.value.width === 0 || paneSize.value.height === 0
    const widthChanged = props.fit === "width" && nextPane.width !== paneSize.value.width
    paneSize.value = nextPane
    contentSize.value = nextContent
    if (pendingView && measured()) {
      applyView(pendingView())
      pendingView = undefined
    }
    else if ((contentChanged && props.autoFit) || paneWasEmpty || widthChanged) fit()
    else view.value = clampPan(view.value, nextPane, nextContent)
  })
  observer.observe(pane.value!)
  observer.observe(content.value!)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  pane.value?.removeEventListener("wheel", onWheel)
  clearTimeout(hintTimer)
})

defineExpose({ fit, zoomIn, zoomOut, moveOrigin, setView, showArea, zoom: computed(() => view.value.zoom), view: computed(() => view.value) })
</script>

<template>
  <div
    ref="pane"
    data-slot="zoom-pane"
    role="group"
    :aria-label="label"
    tabindex="0"
    :class="cn(
      'bg-background relative touch-none overflow-hidden rounded-md border outline-none select-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
      dragging ? 'cursor-grabbing' : 'cursor-grab',
      props.class,
    )"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @click.capture="onClickCapture"
    @keydown="onKeyDown"
  >
    <div ref="content" data-slot="zoom-pane-content" class="absolute top-0 left-0 w-max origin-top-left" :style="{ transform }">
      <slot />
    </div>
    <div class="absolute right-2 bottom-2 flex gap-1 cursor-default">
      <Button variant="outline" size="icon-sm" :aria-label="uiText.zoomIn" :title="uiText.zoomIn" @click="zoomIn">
        <Plus />
      </Button>
      <Button variant="outline" size="icon-sm" :aria-label="uiText.zoomOut" :title="uiText.zoomOut" @click="zoomOut">
        <Minus />
      </Button>
      <Button variant="outline" size="icon-sm" :aria-label="uiText.zoomFit" :title="uiText.zoomFit" @click="fit">
        <Maximize />
      </Button>
    </div>
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity" leave-active-class="transition-opacity">
      <p
        v-if="hint"
        class="bg-popover text-popover-foreground pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-md border px-2 py-1 text-xs shadow-sm"
        aria-hidden="true"
      >
        {{ uiText.zoomHint }}
      </p>
    </Transition>
  </div>
</template>
