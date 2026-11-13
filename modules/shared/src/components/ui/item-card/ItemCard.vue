<script setup lang="ts">
// The shared tooltip's item card inside a panel: the same content (`TooltipContent`, `layout` "card" or "rich") and,
// for a card, the same skin, with its files as URLs (Vite `?url` imports) instead of bundle paths. Tavora's sizes:
// the title and the effect box are larger on a skinned card, everything else stays at the card's text size, and the
// skin's font is only for the title and the effect box.
import type { TooltipContent } from "@tavora/sdk"
import { computed, onBeforeUnmount, ref, watch, type CSSProperties } from "vue"
import { ITEM_CARD_TYPE } from "../../tooltip/typography"
import type { ItemCardSkin } from "."
import { cssUrl, holdSkinFont, releaseSkinFont } from "./skin-font"
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
// A third stats column only when a stat of this card grows (`per`); the rich layout puts it after the value instead.
const hasPer = computed(() => !!props.content.properties?.some((p) => p.per !== undefined))
// An icon before a stat's label; when a stat of the card has one, every label keeps its room so the labels line up.
const hasIcons = computed(() => !!props.content.properties?.some((p) => p.icon !== undefined))
// Made absolute against the page, so the stylesheet's own address can't change what a relative path points at.
const icons = computed(() =>
  (props.content.properties ?? []).map((p) => {
    if (!p.icon) return undefined
    try {
      return cssUrl(new URL(p.icon, document.baseURI).href)
    } catch {
      return undefined
    }
  }),
)
const withPer = (p: { value: string; per?: string }) => (p.per === undefined ? p.value : p.value.trim() ? `${p.value} · ${p.per}` : p.per)
const runs = computed(() => {
  const effect = props.content.effect
  return typeof effect === "string" ? [{ text: effect }] : (effect ?? [])
})

// The skin's font: one FontFace per font URL on the page, shared by every card that uses it.
const family = ref<string>()
watch(
  () => skin.value?.font,
  (url, old) => {
    if (old) releaseSkinFont(old)
    family.value = url ? holdSkinFont(url) : undefined
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (skin.value?.font) releaseSkinFont(skin.value.font)
})

const style = computed<CSSProperties>(() => {
  const s = skin.value
  const style: Record<string, string> = {
    "--ic-title-size": `${s ? ITEM_CARD_TYPE.skinTitle : ITEM_CARD_TYPE.title}px`,
    "--ic-effect-size": `${s ? ITEM_CARD_TYPE.skinEffect : ITEM_CARD_TYPE.effect}px`,
    "--ic-text-size": `${ITEM_CARD_TYPE.text}px`,
    "--ic-small-size": `${ITEM_CARD_TYPE.small}px`,
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
    if (c.boxBorder) style["--skin-box-border"] = c.boxBorder
  }
  if (s?.frame) {
    style.borderImageSource = cssUrl(s.frame.image)
    style.borderImageSlice = s.frame.slice.join(" ")
    style.borderWidth = s.frame.slice.map((n) => `${n}px`).join(" ")
  }
  if (family.value) style["--skin-font"] = `"${family.value}"`
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
    :data-box-edge="skin?.colors?.surface && skin.colors.text && skin.colors.boxBorder ? '' : undefined"
    :data-framed="skin?.frame ? '' : undefined"
    :data-font="skin?.font && family ? '' : undefined"
    :data-caps="skin?.titleCaps ? '' : undefined"
    :data-pixel="skin?.pixelArt ? '' : undefined"
    :style="style"
  >
    <template v-if="layout === 'card'">
      <div v-if="content.image" class="tavora-item-card-art"><img :src="content.image" alt="" /></div>
      <div class="tavora-item-card-name">
        <h3>{{ content.title }}</h3>
        <div v-if="content.badges?.length" class="tavora-item-card-badges">
          <span v-for="(badge, i) in content.badges" :key="i" class="tavora-item-card-badge">{{ badge }}</span>
        </div>
      </div>
      <p v-if="content.subtitle" class="tavora-item-card-type">{{ content.subtitle }}</p>
      <p v-if="runs.length" class="tavora-item-card-effect"><template v-for="(run, i) in runs" :key="i"><span v-if="'accent' in run && run.accent" data-accent>{{ run.text }}</span><template v-else>{{ run.text }}</template></template></p>
      <div v-if="content.properties?.length" class="tavora-item-card-stats" :data-per="hasPer ? '' : undefined" :data-icons="hasIcons ? '' : undefined">
        <template v-if="hasPer && content.perHeading"><span /><span /><span class="tavora-item-card-per-heading">{{ content.perHeading }}</span></template>
        <template v-for="(p, i) in content.properties" :key="i"><span class="tavora-item-card-label"><span v-if="hasIcons" class="tavora-item-card-icon" aria-hidden="true" :data-drawn="icons[i] ? '' : undefined" :style="icons[i] ? { '--ic-icon': icons[i] } : undefined" />{{ p.label }}</span><span class="tavora-item-card-value">{{ p.value }}</span><span v-if="hasPer" class="tavora-item-card-per">{{ p.per ?? "" }}</span></template>
      </div>
      <section v-for="(s, i) in content.sections ?? []" :key="i" class="tavora-item-card-section">
        <p v-if="s.title">{{ s.title }}</p>
        <ul>
          <li v-for="(r, j) in s.rows" :key="j" :data-connected="r.connected ? '' : undefined"><span>{{ r.text }}</span><span v-if="r.status || r.badges?.length">{{ [r.status, ...(r.badges ?? [])].filter(Boolean).join(" ") }}</span></li>
        </ul>
      </section>
      <section v-if="content.requirements?.length" class="tavora-item-card-section">
        <p v-if="requiresLabel">{{ requiresLabel }}</p>
        <div class="tavora-item-card-stats"><template v-for="(r, i) in content.requirements" :key="i"><span class="tavora-item-card-label">{{ r.label }}</span><span class="tavora-item-card-value">{{ r.value }}</span></template></div>
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
          <template v-for="(p, i) in content.properties" :key="i"><dt>{{ p.label }}</dt><dd>{{ withPer(p) }}</dd></template>
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
