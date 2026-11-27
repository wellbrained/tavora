<script setup lang="ts">
// The shared tooltip's item card inside a panel: the same content (`TooltipContent`, `layout` "card", "unit" or "rich")
// and, for a card or a unit, the same skin, with its files as URLs (Vite `?url` imports) instead of bundle paths.
// Tavora's sizes: the title and the effect box are larger on a skinned card, everything else stays at the card's text
// size, and the skin's font is only for the title and the effect box. A unit has the game's sizes, the skin's font
// everywhere and no frame. The card is made of parts (./parts): put your own choice of them, or your own markup, in the
// default slot to build a card of your own that still wears the layout's look and the skin.
// `look: "poe"` (the Path of Exile 2 look) and its rarity colours (`tone`) are drawn as the shared tooltip draws them, in
// the card and rich layouts and without a skin; the rich layout has the shared tooltip's sizes and its requirements under
// the picture, so a card looks the same in the panel as above the workspace.
import type { TooltipContent } from "@tavora/sdk"
import { computed, onBeforeUnmount, ref, watch, type CSSProperties } from "vue"
import { ITEM_CARD_TYPE, TOOLTIP_TYPE, UNIT_CARD_TYPE } from "../../tooltip/typography"
import type { ItemCardSkin } from "."
import { inlineValue, layoutOf, skinColored, tagBadges } from "./content"
import ItemCardArt from "./parts/ItemCardArt.vue"
import ItemCardBar from "./parts/ItemCardBar.vue"
import ItemCardEffect from "./parts/ItemCardEffect.vue"
import ItemCardIcons from "./parts/ItemCardIcons.vue"
import ItemCardName from "./parts/ItemCardName.vue"
import ItemCardPips from "./parts/ItemCardPips.vue"
import ItemCardPortrait from "./parts/ItemCardPortrait.vue"
import ItemCardRequirements from "./parts/ItemCardRequirements.vue"
import ItemCardSections from "./parts/ItemCardSections.vue"
import ItemCardStats from "./parts/ItemCardStats.vue"
import ItemCardType from "./parts/ItemCardType.vue"
import ItemCardUnitStats from "./parts/ItemCardUnitStats.vue"
import { cssUrl, holdSkinFont, releaseSkinFont } from "./skin-font"
import "./item-card.css"

const props = defineProps<{
  content: TooltipContent
  /** Only the card layout wears a skin. */
  skin?: ItemCardSkin
  /** The heading over `requirements` ("Requires"), in the user's language; left out, they show without one. */
  requiresLabel?: string
}>()

const layout = computed(() => layoutOf(props.content))
const skin = computed(() => (layout.value === "rich" ? undefined : props.skin))
const badges = computed(() => tagBadges(props.content))
/** The Path of Exile 2 look: only without a skin, and never on a unit (as in the shared tooltip). */
const poe = computed(() => props.content.look === "poe" && !skin.value && layout.value !== "unit")
/** The rich layout's left column: the picture and the requirements under it; the PoE look keeps it even when empty. */
const richArt = computed(() => Boolean(props.content.image || props.content.requirements?.length || poe.value))

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
  const unit = layout.value === "unit"
  const style: Record<string, string> = unit
    ? { "--ic-title-size": `${UNIT_CARD_TYPE.title}px`, "--ic-text-size": `${UNIT_CARD_TYPE.text}px`, "--ic-small-size": `${UNIT_CARD_TYPE.small}px` }
    : layout.value === "rich"
    ? // The shared tooltip's own sizes for its rich layout: the title, the text, the requirements and rows' tags, badges.
      { "--ic-title-size": `${TOOLTIP_TYPE.title}px`, "--ic-effect-size": `${TOOLTIP_TYPE.text}px`, "--ic-text-size": `${TOOLTIP_TYPE.text}px`, "--ic-meta-size": `${TOOLTIP_TYPE.meta}px`, "--ic-small-size": `${TOOLTIP_TYPE.small}px` }
    : {
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
    if (c.bar) style["--skin-bar"] = c.bar
  }
  // A unit has a shape of its own: it wears no frame.
  if (s?.frame && !unit) {
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
    :data-look="poe ? 'poe' : undefined"
    :data-skinned="skin ? '' : undefined"
    :data-colors="skinColored(skin) ? '' : undefined"
    :data-box-edge="skinColored(skin) && skin?.colors?.boxBorder ? '' : undefined"
    :data-framed="skin?.frame && layout === 'card' ? '' : undefined"
    :data-portrait="layout === 'unit' && content.image ? '' : undefined"
    :data-pips="layout === 'unit' && content.pips ? '' : undefined"
    :data-extra="layout === 'unit' && content.pips?.extra ? '' : undefined"
    :data-font="skin?.font && family ? '' : undefined"
    :data-caps="skin?.titleCaps ? '' : undefined"
    :data-pixel="skin?.pixelArt ? '' : undefined"
    :style="style"
  >
    <slot>
      <template v-if="layout === 'card'">
        <ItemCardArt :content="content" />
        <ItemCardName :content="content" />
        <ItemCardType :content="content" />
        <ItemCardEffect :content="content" />
        <ItemCardStats :content="content" />
        <ItemCardSections :content="content" />
        <ItemCardRequirements :content="content" :label="requiresLabel" />
      </template>
      <template v-else-if="layout === 'unit'">
        <!-- A game unit as the game shows it: the portrait sticks out at the top left over the title bar and the body. -->
        <ItemCardPortrait :content="content" />
        <ItemCardBar :content="content" />
        <div class="tavora-item-card-unit-body">
          <ItemCardType :content="content" />
          <ItemCardEffect :content="content" unit />
          <ItemCardUnitStats :content="content" />
          <ItemCardSections :content="content" />
          <ItemCardIcons :content="content" />
          <ItemCardPips :content="content" />
        </div>
      </template>
      <!-- The rich layout as the shared tooltip draws it: the picture with the requirements under it, beside the text. -->
      <div v-else class="tavora-item-card-rich">
        <div v-if="richArt" class="tavora-item-card-rich-art">
          <img v-if="content.image" :src="content.image" alt="" />
          <ItemCardRequirements :content="content" :label="requiresLabel" rich />
        </div>
        <div class="tavora-item-card-rich-details">
          <div class="tavora-item-card-heading">
            <h3 :data-tone="content.tone">{{ content.title }}</h3>
            <span v-for="(badge, i) in badges" :key="i" class="tavora-item-card-badge">{{ badge }}</span>
          </div>
          <ItemCardType :content="content" />
          <ItemCardEffect :content="content" />
          <div v-if="content.properties?.length" class="tavora-item-card-props">
            <div v-for="(p, i) in content.properties" :key="i"><span>{{ p.label ? `${p.label}: ` : "" }}</span><span class="tavora-item-card-prop-value">{{ inlineValue(p) }}</span></div>
          </div>
          <ItemCardSections :content="content" />
        </div>
      </div>
    </slot>
  </article>
</template>
