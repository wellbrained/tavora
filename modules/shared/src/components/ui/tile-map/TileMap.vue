<script setup lang="ts">
// A map made of picture tiles with pins on it, on top of ZoomPane: drag pans, a plain wheel or a pinch zooms, the
// corner buttons zoom and fit. Only the tiles in view load, at the level that is sharp for the zoom; the least detailed
// level stays underneath, so nothing goes blank while the sharper tiles come in, and a missing tile (sea) shows it.
// Pins keep their size while zooming. Pins close together merge into a group with a count; a click on a group zooms
// in until it splits. Dots (many small points, such as spawns) merge among themselves, never with pins. `highlight`
// fades every other pin and keeps those on top; the `selected` pin is never merged. A click on a pin sends `select`.
// The pins are for the pointer; give keyboards and screen readers the same places as a list next to the map.
// For a saved view use `camera` and setCamera() (the world point in the middle and the zoom); showPins() zooms to
// a set of pins.
import { Check } from "@lucide/vue"
import { computed, ref, shallowRef, type HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { uiText } from "../text"
import { ZoomPane } from "../zoom-pane"
import type { Size, ZoomView } from "../zoom-pane/view"
import { groupFace, groupPins, groupsInView, type MapPin, type MapTone, type PinGroup, pinsArea, tileLevel, type TileSource, visibleTiles } from "./geometry"

const props = withDefaults(defineProps<{
  source: TileSource
  pins?: readonly MapPin[]
  /** The pin drawn as chosen; it never merges into a group. */
  selected?: string | null
  /** Pins to bring forward: the rest fade. Null or empty: all pins look the same. */
  highlight?: readonly string[] | null
  /** What the map shows, for screen readers. */
  label: string
  minZoom?: number
  /** 1 shows the most detailed tiles at their real size. */
  maxZoom?: number
  /** How close pins merge, in screen pixels. */
  cell?: number
  class?: HTMLAttributes["class"]
}>(), { pins: () => [], selected: null, highlight: null, minZoom: 0.02, maxZoom: 2, cell: 48 })

const emit = defineEmits<{ select: [pin: MapPin] }>()
defineSlots<{
  /** The picture on a pin (default: its `icon`); for a group, its most common pin. */
  pin?: (props: { pin: MapPin }) => unknown
}>()

const pane = ref<InstanceType<typeof ZoomPane> | null>(null)
const view = shallowRef<ZoomView>({ x: 0, y: 0, zoom: 1 })
const paneSize = shallowRef<Size>({ width: 0, height: 0 })
function onViewChange(next: ZoomView, size: Size) {
  view.value = next
  paneSize.value = size
}

// ── Tiles ──

const pixelRatio = typeof devicePixelRatio === "number" ? devicePixelRatio : 1
const baseLevel = computed(() => props.source.minLevel ?? 0)
/** Tiles that failed to load (a sea tile a source leaves out); the level underneath shows there. */
const missing = ref(new Set<string>())
const baseTiles = computed(() => visibleTiles({ x: 0, y: 0, zoom: 1 }, { width: props.source.size, height: props.source.size }, props.source, baseLevel.value, 0))
const level = computed(() => tileLevel(view.value.zoom, props.source, pixelRatio))
const tiles = computed(() => (level.value === baseLevel.value || !paneSize.value.width ? [] : visibleTiles(view.value, paneSize.value, props.source, level.value)))
const shownTiles = computed(() => [...baseTiles.value, ...tiles.value].filter((tile) => !missing.value.has(tile.key)))
function onTileError(key: string) {
  missing.value = new Set([...missing.value, key])
}

// ── Pins ──

const highlightSet = computed(() => (props.highlight?.length ? new Set(props.highlight) : null))
const apart = computed(() => new Set(props.selected ? [props.selected] : []))
/** At the highest zoom pins no longer merge: zooming in further would not split them. */
const groups = computed(() => groupPins(props.pins, view.value.zoom, { cell: props.cell, apart: apart.value, highlight: highlightSet.value, merge: view.value.zoom < props.maxZoom * 0.999 }))
/** In view, drawn back to front: faded pins, dots, pins, highlighted ones, the selected one. */
const shown = computed(() => {
  const rank = (group: PinGroup) => (group.pins.some((pin) => pin.id === props.selected) ? 4 : group.highlighted ? 3 : highlightSet.value ? 0 : group.kind === "dot" ? 1 : 2)
  return groupsInView(groups.value, view.value, paneSize.value).sort((a, b) => rank(a) - rank(b))
})

const TONES: Record<MapTone, string> = {
  primary: "bg-primary text-primary-foreground",
  info: "bg-info text-background",
  success: "bg-success text-background",
  warning: "bg-warning text-background",
  destructive: "bg-destructive text-background",
  muted: "bg-muted-foreground text-background",
}
const toneOf = (group: PinGroup) => TONES[group.pins[0]!.tone ?? "primary"]
const faded = (group: PinGroup) => highlightSet.value !== null && !group.highlighted && !group.pins.some((pin) => pin.id === props.selected)
const done = (group: PinGroup) => group.pins.every((pin) => pin.done)
const title = (group: PinGroup) => (group.pins.length === 1 ? group.pins[0]!.label : uiText.value.mapGroup.replace("{count}", String(group.pins.length)))
const place = (group: PinGroup) => `translate(${view.value.x + group.x * view.value.zoom}px, ${view.value.y + group.y * view.value.zoom}px) translate(-50%, -50%)`

function activate(group: PinGroup) {
  if (group.pins.length === 1) emit("select", group.pins[0]!)
  // Zoom in on the group, at most four times as far as now: enough to split it without losing the place.
  else pane.value?.showArea(pinsArea(group.pins, Math.min(paneSize.value.width, paneSize.value.height) / (view.value.zoom * 4)), { padding: props.cell })
}

// ── For the parent ──

/** Zooms to show `ids` (one pin: at real size around it). Pins not on the map are left out. */
function showPins(ids: readonly string[]) {
  const wanted = new Set(ids)
  const found = props.pins.filter((pin) => wanted.has(pin.id))
  if (!found.length) return
  const least = Math.max(paneSize.value.width, paneSize.value.height, 256)
  pane.value?.showArea(pinsArea(found, found.length === 1 ? least : Math.min(least, props.source.size / 16)), { padding: props.cell })
}
/**
 * The world point in the middle of the map and the zoom: what to save to come back to the same view. Null until the
 * map has been shown and measured, so a view saved too early never replaces the first fit.
 */
const camera = computed(() => (paneSize.value.width > 0 && paneSize.value.height > 0 && pane.value ? pane.value.center : null))
function setCamera(next: { x: number, y: number, zoom: number }) {
  pane.value?.setCenter(next, next.zoom)
}

defineExpose({ showPins, camera, setCamera, fit: () => pane.value?.fit(), zoomIn: () => pane.value?.zoomIn(), zoomOut: () => pane.value?.zoomOut() })
</script>

<template>
  <ZoomPane
    ref="pane"
    data-slot="tile-map"
    wheel="zoom"
    :min-zoom="minZoom"
    :max-zoom="maxZoom"
    :label="label"
    :class="cn('bg-muted', props.class)"
    @view-change="onViewChange"
  >
    <div class="relative" :style="{ width: `${source.size}px`, height: `${source.size}px` }">
      <img
        v-for="tile in shownTiles"
        :key="tile.key"
        :src="source.url(tile.level, tile.x, tile.y)"
        alt=""
        draggable="false"
        decoding="async"
        class="absolute max-w-none select-none"
        :style="{ left: `${tile.left}px`, top: `${tile.top}px`, width: `${tile.size}px`, height: `${tile.size}px` }"
        @error="onTileError(tile.key)"
      >
    </div>
    <template #overlay>
      <button
        v-for="group in shown"
        :key="group.id"
        type="button"
        tabindex="-1"
        data-zoom-pane-drag
        :data-pin="group.pins.length === 1 ? group.pins[0]!.id : undefined"
        :data-count="group.pins.length > 1 ? group.pins.length : undefined"
        :title="title(group)"
        :class="cn(
          'pointer-events-auto absolute top-0 left-0 grid place-items-center rounded-full outline-none transition-opacity',
          faded(group) && 'opacity-40',
          group.kind === 'dot'
            ? cn('border-background border-2 text-xs font-semibold tabular-nums shadow-sm', toneOf(group), group.pins.length > 1 ? 'h-6 min-w-6 px-1' : 'size-3.5')
            : cn('bg-card size-9 border shadow-sm', done(group) && 'opacity-60'),
          group.pins.some((pin) => pin.id === selected) && 'ring-primary ring-offset-background ring-2 ring-offset-1',
        )"
        :style="{ transform: place(group) }"
        @click="activate(group)"
      >
        <template v-if="group.kind === 'pin'">
          <slot name="pin" :pin="groupFace(group)">
            <img v-if="groupFace(group).icon" :src="groupFace(group).icon" alt="" draggable="false" class="size-7 max-w-none">
          </slot>
          <span v-if="group.pins.length > 1" class="bg-primary text-primary-foreground absolute -top-1.5 -right-2 grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs font-semibold tabular-nums">{{ group.pins.length }}</span>
          <span v-else-if="done(group)" class="bg-success text-background absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full"><Check class="size-3" :stroke-width="3" aria-hidden="true" /></span>
        </template>
        <template v-else-if="group.pins.length > 1">{{ group.pins.length }}</template>
      </button>
    </template>
  </ZoomPane>
</template>
