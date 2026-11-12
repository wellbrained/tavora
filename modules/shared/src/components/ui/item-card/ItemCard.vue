<script setup lang="ts">
// The shared tooltip's item card inside a panel: the same content (`TooltipContent`, `layout` "card" or "rich") and,
// for a card, the same skin, with its files as URLs (Vite `?url` imports) instead of bundle paths. Tavora's sizes:
// the title and the effect box are larger on a skinned card, everything else stays at the card's text size, and the
// skin's font is only for the title and the effect box.
import type { TooltipContent } from "@tavora/sdk"
import { computed, onBeforeUnmount, ref, watch, type CSSProperties } from "vue"
import { ITEM_CARD_TYPE } from "../../tooltip/typography"
import type { ItemCardSkin } from "."
import "./item-card.css"

const props = defineProps<{
  content: TooltipContent
  /** Only the card layout wears a skin. */
  skin?: ItemCardSkin
  /** The heading over `requirements` ("Requires"), in the user's language; left out, they show without one. */
  requiresLabel?: string
}>()

const layout = computed(() => (props.content.layout === "card" ? "card" : "rich"))
const skin = computed(() => (layout.value === "card" ? props.skin : undefined))
const runs = computed(() => {
  const effect = props.content.effect
  return typeof effect === "string" ? [{ text: effect }] : (effect ?? [])
})

// One FontFace per skin font, named after the card, so two cards with different fonts don't share one.
let face: FontFace | undefined
const family = `tavora-item-card-${Math.random().toString(36).slice(2, 10)}`
const hasFont = ref(false)
/** A URL for CSS `url("…")`: quotes, backslashes and line breaks can't end it early. */
const cssUrl = (url: string) => `url("${url.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`
type FontSet = Set<FontFace>
watch(
  () => skin.value?.font,
  (url) => {
    if (face) (document.fonts as unknown as FontSet).delete(face)
    face = undefined
    hasFont.value = false
    if (!url || typeof FontFace !== "function") return
    face = new FontFace(family, cssUrl(url))
    ;(document.fonts as unknown as FontSet).add(face)
    hasFont.value = true
    face.load().catch(() => {})
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (face) (document.fonts as unknown as FontSet).delete(face)
})

const style = computed<CSSProperties>(() => {
  const s = skin.value
  const style: Record<string, string> = {
    "--ic-title-size": `${s ? ITEM_CARD_TYPE.skinTitle : ITEM_CARD_TYPE.title}px`,
    "--ic-effect-size": `${s ? ITEM_CARD_TYPE.skinEffect : ITEM_CARD_TYPE.effect}px`,
    "--ic-text-size": `${ITEM_CARD_TYPE.text}px`,
  }
  const c = s?.colors
  if (c?.surface && c.text) {
    // A skin's colours are the module's game colours: they stay the same in every theme, like the tooltip's.
    style["--skin-surface"] = c.surface
    style["--skin-text"] = c.text
    style["--skin-muted"] = c.muted ?? c.text
    style["--skin-accent"] = c.accent ?? c.text
    style["--skin-box"] = c.box ?? c.surface
    style["--skin-box-text"] = c.boxText ?? c.text
  }
  if (s?.frame) {
    style.borderImageSource = cssUrl(s.frame.image)
    style.borderImageSlice = s.frame.slice.join(" ")
    style.borderWidth = s.frame.slice.map((n) => `${n}px`).join(" ")
  }
  if (hasFont.value) style["--skin-font"] = `"${family}"`
  return style as CSSProperties
})
</script>

<template>
  <article
    data-slot="item-card"
    class="tavora-item-card"
    :data-layout="layout"
    :data-skinned="skin ? '' : undefined"
    :data-colors="skin?.colors?.surface && skin.colors.text ? '' : undefined"
    :data-framed="skin?.frame ? '' : undefined"
    :data-font="skin?.font && hasFont ? '' : undefined"
    :data-caps="skin?.titleCaps ? '' : undefined"
    :data-pixel="skin?.pixelArt ? '' : undefined"
    :style="style"
  >
    <template v-if="layout === 'card'">
      <div v-if="content.image" class="tavora-item-card-art"><img :src="content.image" alt="" /></div>
      <div class="tavora-item-card-name"><h3>{{ content.title }}</h3></div>
      <p v-if="content.subtitle" class="tavora-item-card-type">{{ content.subtitle }}</p>
      <div v-if="content.badges?.length" class="tavora-item-card-badges">
        <span v-for="(badge, i) in content.badges" :key="i" class="tavora-item-card-badge">{{ badge }}</span>
      </div>
      <p v-if="runs.length" class="tavora-item-card-effect"><template v-for="(run, i) in runs" :key="i"><span v-if="'accent' in run && run.accent" data-accent>{{ run.text }}</span><template v-else>{{ run.text }}</template></template></p>
      <dl v-if="content.properties?.length" class="tavora-item-card-props">
        <template v-for="(p, i) in content.properties" :key="i"><dt>{{ p.label }}</dt><dd>{{ p.value }}</dd></template>
      </dl>
      <section v-for="(s, i) in content.sections ?? []" :key="i" class="tavora-item-card-section">
        <p v-if="s.title">{{ s.title }}</p>
        <ul>
          <li v-for="(r, j) in s.rows" :key="j" :data-connected="r.connected ? '' : undefined"><span>{{ r.text }}</span><span v-if="r.status || r.badges?.length">{{ [r.status, ...(r.badges ?? [])].filter(Boolean).join(" ") }}</span></li>
        </ul>
      </section>
      <section v-if="content.requirements?.length" class="tavora-item-card-section">
        <p v-if="requiresLabel">{{ requiresLabel }}</p>
        <dl class="tavora-item-card-props"><template v-for="(r, i) in content.requirements" :key="i"><dt>{{ r.label }}</dt><dd>{{ r.value }}</dd></template></dl>
      </section>
    </template>
    <div v-else class="tavora-item-card-rich">
      <img v-if="content.image" :src="content.image" alt="" />
      <div>
        <div class="tavora-item-card-heading">
          <h3>{{ content.title }}</h3>
          <span v-for="(badge, i) in content.badges ?? []" :key="i" class="tavora-item-card-badge">{{ badge }}</span>
        </div>
        <p v-if="content.subtitle" class="tavora-item-card-type">{{ content.subtitle }}</p>
        <p v-if="runs.length" class="tavora-item-card-effect"><template v-for="(run, i) in runs" :key="i"><span v-if="'accent' in run && run.accent" data-accent>{{ run.text }}</span><template v-else>{{ run.text }}</template></template></p>
        <dl v-if="content.properties?.length" class="tavora-item-card-props">
          <template v-for="(p, i) in content.properties" :key="i"><dt>{{ p.label }}</dt><dd>{{ p.value }}</dd></template>
        </dl>
        <section v-for="(s, i) in content.sections ?? []" :key="i" class="tavora-item-card-section">
          <p v-if="s.title">{{ s.title }}</p>
          <ul>
            <li v-for="(r, j) in s.rows" :key="j" :data-connected="r.connected ? '' : undefined"><span>{{ r.text }}</span><span v-if="r.status || r.badges?.length">{{ [r.status, ...(r.badges ?? [])].filter(Boolean).join(" ") }}</span></li>
          </ul>
        </section>
        <section v-if="content.requirements?.length" class="tavora-item-card-section">
          <p v-if="requiresLabel">{{ requiresLabel }}</p>
          <dl class="tavora-item-card-props"><template v-for="(r, i) in content.requirements" :key="i"><dt>{{ r.label }}</dt><dd>{{ r.value }}</dd></template></dl>
        </section>
      </div>
    </div>
  </article>
</template>
