import type { TooltipSkin } from "@tavora/sdk"

export { default as ItemCard } from "./ItemCard.vue"
export { default as ItemTooltip } from "./ItemTooltip.vue"
// The card's parts, each drawn from the same content: put them in an ItemCard's slot to build a card of your own.
export { default as ItemCardArt } from "./parts/ItemCardArt.vue"
export { default as ItemCardName } from "./parts/ItemCardName.vue"
export { default as ItemCardType } from "./parts/ItemCardType.vue"
export { default as ItemCardEffect } from "./parts/ItemCardEffect.vue"
export { default as ItemCardStats } from "./parts/ItemCardStats.vue"
export { default as ItemCardSections } from "./parts/ItemCardSections.vue"
export { default as ItemCardRequirements } from "./parts/ItemCardRequirements.vue"
export { default as ItemCardPortrait } from "./parts/ItemCardPortrait.vue"
export { default as ItemCardBar } from "./parts/ItemCardBar.vue"
export { default as ItemCardUnitStats } from "./parts/ItemCardUnitStats.vue"
export { default as ItemCardIcons } from "./parts/ItemCardIcons.vue"
export { default as ItemCardPips } from "./parts/ItemCardPips.vue"
export { default as ItemCardBlocks } from "./parts/ItemCardBlocks.vue"
export { default as ItemCardFooter } from "./parts/ItemCardFooter.vue"
export { fromBundle, layoutOf, type ItemCardLayout } from "./content"

/**
 * A skin for `ItemCard`: the same values as the one you give `sdk.ui.tooltip.defineSkin`, but `frame.image` and `font`
 * are URLs your page can load (Vite `?url` imports) instead of paths in `dist/`. The kit doesn't check its contrast;
 * use the skin Tavora accepted for the tooltip.
 */
export type ItemCardSkin = TooltipSkin
