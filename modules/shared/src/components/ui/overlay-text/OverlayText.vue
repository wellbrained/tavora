<script setup lang="ts">
// OverlayText for Vue: the slot's lines in an overlay text box (overlay-text.ts). The element is the box, so give it a
// size. Each line is a block; give its parts sizes in `em` (1em is `font-size` at 100 %). A change to the lines is
// picked up by itself; `content-key` says whether it is the same thing (a running scroll goes on) or a new one.
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue"
import { mountOverlayText, type OverlayText, type OverlayTextAlign } from "./overlay-text"
import { DEFAULT_PAUSE, type OverlayTextBox, type OverlayTextScaleBy, type OverlayTextSpeed, type OverlayTextTooLong } from "./plan"

interface Props {
  box?: OverlayTextBox
  scaleBy?: OverlayTextScaleBy
  tooLong?: OverlayTextTooLong
  speed?: OverlayTextSpeed
  pause?: number
  softEdges?: boolean
  align?: OverlayTextAlign
  padding?: number
  /** Pixels at 100 %. */
  fontSize?: number
  /** What the lines show; another key starts a scroll from the start. */
  contentKey?: string
  /** False stops the scroll (the text isn't shown). */
  active?: boolean
}

const props = withDefaults(defineProps<Props>(), { box: "grow", scaleBy: "down", tooLong: "scroll", speed: "normal", pause: DEFAULT_PAUSE, softEdges: true, align: "center", padding: 0, fontSize: 16, contentKey: "", active: true })

const host = useTemplateRef<HTMLElement>("host")
const lines = useTemplateRef<HTMLElement>("lines")
let text: OverlayText | undefined
let resize: ResizeObserver | undefined
let mutations: MutationObserver | undefined

const options = () => ({ box: props.box, scaleBy: props.scaleBy, tooLong: props.tooLong, speed: props.speed, pause: props.pause, softEdges: props.softEdges, align: props.align, padding: props.padding, fontSize: props.fontSize })

onMounted(() => {
  const source = lines.value!
  text = mountOverlayText(host.value!, options())
  // Vue keeps patching the slot's element, wherever it sits; the box only moves it into its track once.
  text.content.append(source)
  text.setActive(props.active)
  text.refresh(props.contentKey)
  mutations = new MutationObserver(() => text?.refresh(props.contentKey))
  mutations.observe(source, { subtree: true, childList: true, characterData: true, attributes: true })
  resize = new ResizeObserver(() => text?.fit())
  resize.observe(host.value!)
  void document.fonts?.ready.then(() => text?.fit())
})

watch(options, (next) => text?.configure(next))
watch(() => props.contentKey, (next) => text?.refresh(next))
watch(() => props.active, (next) => text?.setActive(next))

onBeforeUnmount(() => {
  mutations?.disconnect()
  resize?.disconnect()
  text?.destroy()
})
</script>

<template>
  <div ref="host" data-slot="overlay-text">
    <div ref="lines" class="contents" data-overlay-text-lines><slot /></div>
  </div>
</template>
