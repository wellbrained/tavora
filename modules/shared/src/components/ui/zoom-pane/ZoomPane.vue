<script setup lang="ts">
// A viewport that pans and zooms what is inside it, for maps, trees and other big pictures. One control group sits
// bottom right: − , the zoom in % (a click puts it back to 100 %), + , then Whole map. The `extras` slot puts a game's
// own buttons after it. Inputs: drag pans, the wheel zooms toward the pointer (wheel "zoom") or keeps scrolling the page
// with a short hint, Ctrl + wheel or a pinch zooms, a double-click zooms one step in toward that point (doubleClick "off"
// keeps it for the content). With focus: + and - zoom, 0 shows the whole content, 1 goes back to 100 %, arrow keys pan.
// The steps and the % count from `hundred`, the internal zoom that counts as 100 % (default 1, the content's real size).
// While the pane is hidden (display: none) it keeps its last size and view and shows them again as they were.
// The content is fitted when it first shows and whenever its size changes. With autoFit off
// only when it first shows, so content that grows (a box dragged past the edge) keeps the view.
// With fit "width" the content fills the width and is read top to bottom like a page: a
// plain wheel scrolls it, and it is fitted again when the pane's width changes.
// A parent can read `view`, put a saved one back with setView() and show an area with showArea(); `center` and
// setCenter() do the same with the content point in the middle, which stays right when the pane's size changes. Jumps
// can glide (a moment, never longer than 300 ms, none with reduced motion): Whole map and showArea() do, setView() and
// setCenter() do with `{ glide: true }`; the first show and a restored view never do.
// `persistKey` makes the pane remember its view in the module's storage and open on it; nothing saved: the whole content.
// The `overlay` slot lies over the content without being scaled (pins that keep their size); its `view` and `pane` slot
// props place things on it. Inside the content or the overlay, a pan never starts on a button or a field, unless it is
// marked `data-zoom-pane-drag`.
// With `viewOnly` the pane does all of the above but moves nothing: for a game that draws itself (a canvas, an SVG).
// The default slot gets the `view` and the `pane` size (also sent as viewChange) and fills the pane, the game draws with
// them; `world` is the size of what it draws, in its own units at zoom 1, so fitting and the limits know the content.
import type { HTMLAttributes } from "vue"
import { Maximize, Minus, Plus } from "@lucide/vue"
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from "vue"
import { cn } from "../../../lib/utils"
import { Button } from "../button"
import { Separator } from "../separator"
import { uiText } from "../text"
import { zoomPaneKey } from "./context"
import { createGlide } from "./glide"
import { areaView, clampPan, clampZoom, containZoom, fitView, percentOf, type Size, stepZoom, type ViewOptions, type ZoomAlign, type ZoomArea, type ZoomBounds, type ZoomFit, zoomAt, type ZoomView } from "./view"
import { createViewMemory, type SavedView, type ViewMemory } from "./view-memory"

const props = withDefaults(defineProps<{
  /** Smallest and largest zoom, in the pane's own units: 1 is the content's real size (not 100 %, see `hundred`). */
  minZoom?: number
  maxZoom?: number
  /** The zoom that reads as 100 %: the % shown, the + and - steps and a click on the % all count from it. */
  hundred?: number
  /** Fitting never goes below this zoom; bigger content then starts at the side `align` names. Defaults to minZoom. */
  fitFloor?: number
  align?: ZoomAlign
  /** Fit the whole content, or only its width (a plain wheel then scrolls it). */
  fit?: ZoomFit
  /** Fit again whenever the content changes size. Off: only the first show fits; call fit() when the content is new. */
  autoFit?: boolean
  /** What a plain wheel does: scroll the page (Ctrl + wheel zooms), or zoom toward the pointer, as on a map. */
  wheel?: "scroll" | "zoom"
  /** What a double-click does: zoom one step in toward the pointer, or nothing (for content with its own double-click). */
  doubleClick?: "zoom" | "off"
  /**
   * "content" keeps the pane covered by the content (centred where it is smaller), never zooms out past the whole
   * content and fits it edge to edge: for a map. "loose" (default) lets an edge move to the middle of the pane.
   */
  bounds?: ZoomBounds
  /** The pane takes every input and keeps the view but does not move its content: the content draws itself with `view`. */
  viewOnly?: boolean
  /** With `viewOnly`: the size of what is drawn, at zoom 1 (the units the view's x, y and zoom use). */
  world?: Size
  /** Remembers the view (the middle point and the zoom) in the module's storage under this key, and opens on it. */
  persistKey?: string
  /** The hint on the Whole map button, for content that is not a map ("Show the whole tree"). */
  wholeLabel?: string
  /** What the pane shows, for screen readers. */
  label?: string
  class?: HTMLAttributes["class"]
}>(), {
  minZoom: 0.25,
  maxZoom: 2,
  hundred: 1,
  align: "center",
  fit: "whole",
  autoFit: true,
  wheel: "scroll",
  doubleClick: "zoom",
  bounds: "loose",
})
const emit = defineEmits<{
  /** The view or the pane's size changed (on every frame of a glide). */
  viewChange: [view: ZoomView, pane: Size]
}>()
defineSlots<{
  /** The content. With `viewOnly` it fills the pane unmoved and gets the view to draw with. */
  default?: (props: { view: ZoomView, pane: Size }) => unknown
  /** Over the content, not scaled: things that keep their size. */
  overlay?: (props: { view: ZoomView, pane: Size }) => unknown
  /** The game's own buttons, after Whole map. Use the kit's ghost icon buttons (`size="icon-sm"`). */
  extras?: () => unknown
}>()

/** How far an arrow key pans, in pixels. */
const PAN_STEP = 48
/** A pointer must move this far before it pans, so clicks inside still work. */
const DRAG_START = 4
/** Elements a pan never starts on, and a double-click never zooms on. */
const INTERACTIVE = "button, a, input, select, textarea, [role=button], [role=combobox], [contenteditable=true], [data-zoom-pane-ignore]"
/** A saved view that does not come back in this time is given up on, so the pane never stays hidden. */
const RESTORE_WAIT_MS = 1500
/** A double-click this soon after the view moved is not a zoom. */
const DOUBLE_CLICK_QUIET_MS = 500

const pane = ref<HTMLElement>()
const content = ref<HTMLElement>()
const view = ref<ZoomView>({ x: 0, y: 0, zoom: 1 })
const dragging = ref(false)
const hint = ref(false)
/** Waiting for the saved view: the content stays hidden so the whole map does not flash before it. */
const restoring = ref(Boolean(props.persistKey))
provide(zoomPaneKey, { element: pane, view })

/** With bounds "content" the least zoom shows the whole content, no smaller. */
const limits = computed(() => {
  const min = props.bounds === "content" ? Math.max(props.minZoom, containZoom(paneSize.value, contentSize.value)) : props.minZoom
  return { min, max: Math.max(props.maxZoom, min) }
})
const paneSize = ref<Size>({ width: 0, height: 0 })
const contentSize = ref<Size>({ width: 0, height: 0 })
const transform = computed(() => `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.zoom})`)
const percent = computed(() => percentOf(view.value.zoom, props.hundred))

/** A glide is on its way: the view changes on every frame, so what only needs the end result can wait for this to be false. */
const gliding = ref(false)
const glide = createGlide((next) => {
  view.value = next
}, () => {
  gliding.value = false
  remember(view.value)
})
/** Stops a glide where it is, and keeps that spot (not the target it was heading for) as the view to remember. */
function stopGlide() {
  if (!glide.running) return
  glide.cancel()
  gliding.value = false
  remember(view.value)
}
/** When the view last moved by itself or by the pointer (a jump, a pan, the wheel): a double-click right after is not a zoom. */
let lastMovedAt = -Infinity
/** The view when the last pointer went down. */
let pressView: ZoomView | undefined
/** A call from the parent (setView, showArea, fit…) was made: a saved view that comes back later does not replace it. */
let parentAsked = false
/** A saved view was put back: the content growing later does not fit it again. */
let restored = false

// ── The view ──

/** The view that shows the whole content. */
function wholeView(): ZoomView {
  if (props.bounds === "content") return clampPan({ x: 0, y: 0, zoom: limits.value.min }, paneSize.value, contentSize.value, "content")
  return fitView(paneSize.value, contentSize.value, limits.value, props.fitFloor ?? props.minZoom, props.align, props.fit)
}
/** The content point in the middle of the pane, and the zoom. */
const center = computed(() => ({ x: (paneSize.value.width / 2 - view.value.x) / view.value.zoom, y: (paneSize.value.height / 2 - view.value.y) / view.value.zoom, zoom: view.value.zoom }))
const middle = () => ({ x: paneSize.value.width / 2, y: paneSize.value.height / 2 })
const measured = () => paneSize.value.width > 0 && paneSize.value.height > 0 && contentSize.value.width > 0 && contentSize.value.height > 0
/** The view that puts `point` (content pixels) in the middle of the pane at `zoom` (default: the zoom now). */
function centred(point: { x: number, y: number }, zoom?: number): ZoomView {
  const next = clampZoom(zoom ?? view.value.zoom, limits.value)
  return { zoom: next, x: paneSize.value.width / 2 - point.x * next, y: paneSize.value.height / 2 - point.y * next }
}
/** The view a parent asked for before the pane was measured, worked out once it is; it replaces the first fit. */
let pendingView: (() => ZoomView) | undefined
/** The pane has no box right now (display: none somewhere above it): its last real size and view are kept as they were. */
let hidden = false

// What the pane remembers (props.persistKey): written once the view has been still for a moment.
let memory: ViewMemory | undefined
function remember(next: ZoomView) {
  if (!memory || restoring.value || !measured()) return
  memory.save({ x: (paneSize.value.width / 2 - next.x) / next.zoom, y: (paneSize.value.height / 2 - next.y) / next.zoom, zoom: next.zoom })
}
let restoreTimer: ReturnType<typeof setTimeout> | undefined
function settled() {
  clearTimeout(restoreTimer)
  restoring.value = false
}
async function openMemory(key: string, first: boolean) {
  void memory?.flush()
  const mine = (memory = createViewMemory(key))
  parentAsked = false
  restored = false
  // The content stays hidden until the saved view is in, or for a while at most: a view that comes later is not put back
  // (it would make the map jump), and the pane keeps what it shows.
  restoring.value = true
  let gaveUp = false
  clearTimeout(restoreTimer)
  restoreTimer = setTimeout(() => {
    gaveUp = true
    restoring.value = false
  }, RESTORE_WAIT_MS)
  const saved: SavedView | null = await mine.load()
  if (memory !== mine || gaveUp) return
  // What the parent asked for before this came back wins. Not a move the user made: no glide, nothing to write back.
  if (!parentAsked) {
    if (saved) {
      restored = true
      whenMeasured(() => centred(saved, saved.zoom), { remember: false, restore: true })
    }
    else if (!first) whenMeasured(wholeView, { remember: false, restore: true })
  }
  settled()
  if (parentAsked) remember(view.value)
}

/** Shows `next`, kept in reach: at once, or gliding there. */
function show(next: ZoomView, options: ViewOptions & { remember?: boolean } = {}) {
  const target = clampPan({ ...next, zoom: clampZoom(next.zoom, limits.value) }, paneSize.value, contentSize.value, props.bounds)
  stopGlide()
  lastMovedAt = performance.now()
  if (options.glide) {
    // Remembered when it gets there, or where it is stopped.
    gliding.value = true
    glide.start(view.value, target, paneSize.value)
    return
  }
  view.value = target
  if (options.remember !== false) remember(target)
}
function whenMeasured(next: () => ZoomView, options: ViewOptions & { remember?: boolean, restore?: boolean } = {}) {
  if (!options.restore) parentAsked = true
  // Hidden: the newest ask waits and lands, re-clamped to the size it comes back with, when the pane shows again.
  if (measured() && !hidden) show(next(), options)
  else pendingView = next
}

// ── For the parent, and the buttons ──

/** Shows the whole content. A button glides there; a call from code jumps unless `{ glide: true }`. */
function fit(options: ViewOptions = {}) {
  show(wholeView(), options)
}
function zoomBy(factor: number, at = middle()) {
  stopGlide()
  view.value = zoomAt(view.value, factor, at, limits.value, paneSize.value, contentSize.value, props.bounds)
  remember(view.value)
}
/** One step in (1) or out (-1) on the ladder that counts from `hundred`. */
function zoomStep(direction: 1 | -1, at = middle()) {
  zoomBy(stepZoom(view.value.zoom, props.hundred, direction) / view.value.zoom, at)
}
/** Back to 100 %, around the middle of the pane. */
function actualSize() {
  zoomBy(props.hundred / view.value.zoom)
}
function panBy(dx: number, dy: number, from = view.value) {
  stopGlide()
  view.value = clampPan({ ...from, x: from.x + dx, y: from.y + dy }, paneSize.value, contentSize.value, props.bounds)
  remember(view.value)
}
/**
 * The content is about to be drawn shifted by dx, dy (content pixels), for example because it grew to the
 * left: moves the view along so nothing jumps. Not clamped; the next size check clamps with the new size.
 */
function moveOrigin(dx: number, dy: number) {
  view.value = { ...view.value, x: view.value.x - dx * view.value.zoom, y: view.value.y - dy * view.value.zoom }
}
/** Puts `point` (content pixels) in the middle of the pane at `zoom` (default: the zoom now). Before the first show it is used instead of the first fit. */
function setCenter(point: { x: number, y: number }, zoom?: number, options: ViewOptions = {}) {
  const copy = { ...point }
  whenMeasured(() => centred(copy, zoom), options)
}
/** Sets the view (for example one saved earlier). Zoom and pan are kept in reach. Before the first show it is used instead of the first fit. */
function setView(next: ZoomView, options: ViewOptions = {}) {
  const copy = { ...next }
  whenMeasured(() => copy, options)
}
/**
 * Zooms and pans so `area` (content pixels at zoom 1) fills the pane, centred, with `padding` pixels around it. It glides
 * there unless `glide` is false. Before the first show it is used instead of the first fit.
 */
function showArea(area: ZoomArea, options: ViewOptions & { padding?: number } = {}) {
  const copy = { ...area }
  whenMeasured(() => areaView(paneSize.value, copy, limits.value, options.padding ?? 24), { glide: options.glide ?? true })
}
const zoomIn = () => zoomStep(1)
const zoomOut = () => zoomStep(-1)

// ── Pointers: one pans, two (touch) pinch ──

function local(event: { clientX: number, clientY: number }) {
  const box = pane.value!.getBoundingClientRect()
  return { x: event.clientX - box.left, y: event.clientY - box.top }
}

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
  pressView = view.value
  if (event.pointerType === "mouse" && event.button !== 0) return
  if (event.target instanceof Element && event.target.closest(INTERACTIVE) && !event.target.closest("[data-zoom-pane-drag]") && event.pointerType === "mouse") return
  // A glide goes on under a plain press (a click, the first half of a double-click) and stops when a pan or pinch begins.
  pointers.set(event.pointerId, local(event))
  if (pointers.size === 1) {
    drag = { start: local(event), from: view.value, id: event.pointerId }
  }
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number, y: number }, { x: number, y: number }]
    drag = null
    stopGlide()
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
    lastMovedAt = performance.now()
    const zoomed = zoomAt(pinch.from, distance(a, b) / pinch.distance, pinch.middle, limits.value, paneSize.value, contentSize.value, props.bounds)
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
    // The pan starts from where the view is now: a glide that was on its way stops here.
    stopGlide()
    lastMovedAt = performance.now()
    drag.from = view.value
    drag.start = at
    return
  }
  lastMovedAt = performance.now()
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

/**
 * One step in toward the point that was double-clicked. Not on a button or field, which have their own meaning, and not
 * when the view has just moved: a click on a group of pins zooms in and the pins vanish, so the second click of a
 * double-click lands on the map and would zoom again; a drag, a jump or the wheel just before is no double-click either.
 */
function onDoubleClick(event: MouseEvent) {
  if (props.doubleClick === "off") return
  if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return
  if (performance.now() - lastMovedAt < DOUBLE_CLICK_QUIET_MS) return
  const from = pressView
  if (from && (Math.abs(from.zoom - view.value.zoom) > 1e-6 || Math.abs(from.x - view.value.x) > 0.5 || Math.abs(from.y - view.value.y) > 0.5)) return
  zoomStep(1, local(event))
}

let hintTimer: ReturnType<typeof setTimeout> | undefined
function onWheel(event: WheelEvent) {
  if (!event.ctrlKey && props.fit === "width" && props.wheel !== "zoom") {
    // Read like a page: the wheel scrolls, Shift + wheel goes sideways.
    event.preventDefault()
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1
    const sideways = event.shiftKey && !event.deltaX
    panBy(-(sideways ? event.deltaY : event.deltaX) * lines, sideways ? 0 : -event.deltaY * lines)
    return
  }
  if (!event.ctrlKey && props.wheel !== "zoom") {
    // A plain wheel scrolls the page; say how to zoom instead.
    hint.value = true
    clearTimeout(hintTimer)
    hintTimer = setTimeout(() => (hint.value = false), 1500)
    return
  }
  event.preventDefault()
  hint.value = false
  lastMovedAt = performance.now()
  const speed = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 0.05 : 0.002
  zoomBy(Math.exp(-event.deltaY * speed), local(event))
}

function onKeyDown(event: KeyboardEvent) {
  if (event.target !== pane.value || event.ctrlKey || event.altKey || event.metaKey) return
  const actions: Record<string, () => void> = {
    "+": zoomIn,
    "=": zoomIn,
    "-": zoomOut,
    // A key press never glides: the view is where you wanted it at once.
    "0": () => fit(),
    "1": actualSize,
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

watch([view, paneSize], () => emit("viewChange", view.value, paneSize.value))

// ── Measuring ──

/** Reads the pane's and the content's size and keeps the view right for them. */
function measure() {
  if (!pane.value || !content.value) return
  const nextPane = { width: pane.value.clientWidth, height: pane.value.clientHeight }
  // 0 x 0 (or no width, or no height) means "not visible", not a size: nothing is clamped, fitted or sent.
  hidden = nextPane.width <= 0 || nextPane.height <= 0
  if (hidden) return
  // offsetWidth is the size before the transform, so zooming does not change it. A view-only pane has no content to measure: the parent says (`world`).
  const nextContent = props.viewOnly ? { width: props.world?.width ?? 0, height: props.world?.height ?? 0 } : { width: content.value.offsetWidth, height: content.value.offsetHeight }
  const contentChanged = nextContent.width !== contentSize.value.width || nextContent.height !== contentSize.value.height
  const paneWasEmpty = paneSize.value.width === 0 || paneSize.value.height === 0
  const widthChanged = props.fit === "width" && nextPane.width !== paneSize.value.width
  paneSize.value = nextPane
  contentSize.value = nextContent
  if (pendingView && measured()) {
    // The first show, or a restored view: it never glides.
    const asked = pendingView()
    pendingView = undefined
    stopGlide()
    view.value = clampPan({ ...asked, zoom: clampZoom(asked.zoom, limits.value) }, nextPane, nextContent, props.bounds)
  }
  // A view that was put back from storage is the user's: content that grows later does not fit it again.
  else if ((contentChanged && props.autoFit && !restored) || paneWasEmpty || widthChanged) {
    stopGlide()
    view.value = wholeView()
  }
  else view.value = clampPan({ ...view.value, zoom: clampZoom(view.value.zoom, limits.value) }, nextPane, nextContent, props.bounds)
}
watch(() => [props.world?.width, props.world?.height], () => {
  if (props.viewOnly) measure()
})
watch(() => props.persistKey, (key) => {
  if (key) void openMemory(key, false)
  else {
    void memory?.flush()
    memory = undefined
  }
})

let observer: ResizeObserver | undefined
/** The page is going away or hiding: write the view now, the debounce may not get its turn. */
const saveNow = () => void memory?.flush()
const onVisibility = () => {
  if (document.visibilityState === "hidden") saveNow()
}
onMounted(() => {
  // The wheel listener must not be passive, so Ctrl + wheel can stop the page from zooming.
  pane.value!.addEventListener("wheel", onWheel, { passive: false })
  observer = new ResizeObserver(measure)
  observer.observe(pane.value!)
  observer.observe(content.value!)
  if (props.persistKey) void openMemory(props.persistKey, true)
  window.addEventListener("pagehide", saveNow)
  document.addEventListener("visibilitychange", onVisibility)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  stopGlide()
  pane.value?.removeEventListener("wheel", onWheel)
  window.removeEventListener("pagehide", saveNow)
  document.removeEventListener("visibilitychange", onVisibility)
  clearTimeout(hintTimer)
  clearTimeout(restoreTimer)
  saveNow()
  memory = undefined
})

defineExpose({ fit, actualSize, zoomIn, zoomOut, moveOrigin, setView, showArea, setCenter, center, percent, gliding, zoom: computed(() => view.value.zoom), view: computed(() => view.value), pane: computed(() => paneSize.value) })
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
    @dblclick="onDoubleClick"
    @keydown="onKeyDown"
  >
    <div
      ref="content"
      data-slot="zoom-pane-content"
      :class="cn(viewOnly ? 'absolute inset-0' : 'absolute top-0 left-0 w-max origin-top-left', restoring && 'invisible')"
      :style="viewOnly ? undefined : { transform }"
    >
      <slot :view="view" :pane="paneSize" />
    </div>
    <div v-if="$slots.overlay" data-slot="zoom-pane-overlay" :class="cn('pointer-events-none absolute inset-0 overflow-hidden', restoring && 'invisible')">
      <slot name="overlay" :view="view" :pane="paneSize" />
    </div>
    <div
      data-slot="zoom-controls"
      role="group"
      :aria-label="uiText.zoomControls"
      data-zoom-pane-ignore
      class="bg-background/90 absolute right-2 bottom-2 flex cursor-default items-center gap-0.5 rounded-md border p-0.5 shadow-sm"
      @pointerdown.stop
      @dblclick.stop
    >
      <Button variant="ghost" size="icon-sm" :title="uiText.zoomOut" :aria-label="uiText.zoomOut" data-testid="zoom-out" @click="zoomOut">
        <Minus />
      </Button>
      <Button variant="ghost" size="sm" class="text-muted-foreground min-w-12 px-1.5 tabular-nums" :title="uiText.zoomReset" :aria-label="uiText.zoomPercent.replace('{percent}', String(percent))" data-testid="zoom-percent" @click="actualSize">
        {{ percent }}%
      </Button>
      <Button variant="ghost" size="icon-sm" :title="uiText.zoomIn" :aria-label="uiText.zoomIn" data-testid="zoom-in" @click="zoomIn">
        <Plus />
      </Button>
      <Separator orientation="vertical" class="data-[orientation=vertical]:h-4 mx-0.5" />
      <Button variant="ghost" size="icon-sm" :title="wholeLabel ?? uiText.zoomWhole" :aria-label="wholeLabel ?? uiText.zoomWhole" data-testid="zoom-whole" @click="fit({ glide: true })">
        <Maximize />
      </Button>
      <slot name="extras" />
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
