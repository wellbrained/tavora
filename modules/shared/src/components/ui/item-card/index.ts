import type { TooltipSkin } from "@tavora/sdk"

export { default as ItemCard } from "./ItemCard.vue"

/**
 * A skin for `ItemCard`: the same values as the one you give `sdk.ui.tooltip.defineSkin`, but `frame.image` and `font`
 * are URLs your page can load (Vite `?url` imports) instead of paths in `dist/`. The kit doesn't check its contrast;
 * use the skin Tavora accepted for the tooltip.
 */
export type ItemCardSkin = TooltipSkin
