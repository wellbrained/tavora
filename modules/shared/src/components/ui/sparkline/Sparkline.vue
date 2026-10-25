<script setup lang="ts">
// A tiny line chart with no axes or labels: a line and a faint area under it. Drawn on a canvas, only when the values,
// the size or the colour change; no animation and no timers (a ResizeObserver tells it about the size).
import { onBeforeUnmount, onMounted, ref, watch } from "vue"
import { cn } from "../../../lib/utils"
import { sparkPoints } from "./points"

const props = withDefaults(
  defineProps<{
    /** Oldest first. */
    values: readonly number[]
    min?: number
    max?: number
    /** Height in pixels. */
    height?: number
    /** A theme token name (`primary`, `success`, `warning`, ...). */
    color?: string
    class?: string
    label?: string
  }>(),
  { min: 0, max: 100, height: 40, color: "primary" },
)

const canvas = ref<HTMLCanvasElement | null>(null)
let width = 0
let observer: ResizeObserver | null = null

function draw(): void {
  const element = canvas.value
  const context = element?.getContext("2d")
  if (!element || !context) return
  const scale = window.devicePixelRatio || 1
  const pixelWidth = Math.round(width * scale)
  const pixelHeight = Math.round(props.height * scale)
  // Changing the size clears the canvas; otherwise clear by hand.
  if (element.width !== pixelWidth || element.height !== pixelHeight) {
    element.width = pixelWidth
    element.height = pixelHeight
  } else context.clearRect(0, 0, pixelWidth, pixelHeight)
  const points = sparkPoints(props.values, width, props.height, props.min, props.max)
  if (points.length < 2) return
  context.setTransform(scale, 0, 0, scale, 0, 0)
  const colour = getComputedStyle(element).getPropertyValue(`--${props.color}`).trim() || "currentColor"
  context.beginPath()
  points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)))
  context.strokeStyle = colour
  context.lineWidth = 1.5
  context.lineJoin = "round"
  context.stroke()
  context.lineTo(width, props.height)
  context.lineTo(0, props.height)
  context.closePath()
  context.globalAlpha = 0.14
  context.fillStyle = colour
  context.fill()
  context.globalAlpha = 1
}

onMounted(() => {
  const element = canvas.value
  if (!element) return
  width = element.clientWidth
  draw()
  observer = new ResizeObserver(() => {
    const next = element.clientWidth
    if (next === width) return
    width = next
    draw()
  })
  observer.observe(element)
})
onBeforeUnmount(() => observer?.disconnect())
watch(() => [props.values, props.min, props.max, props.height, props.color], draw, { flush: "post" })
</script>

<template>
  <canvas
    ref="canvas"
    data-slot="sparkline"
    :class="cn('block w-full', props.class)"
    :style="{ height: `${height}px` }"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : true"
  />
</template>
