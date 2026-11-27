<script setup lang="ts">
// An item card in the panel's own tooltip: the same content (`TooltipContent`) you would give the shared tooltip
// (`sdk.ui.tooltip.show`), so a card is described once and shows in either. With useTooltip:
//
//   const tip = useTooltip<TooltipContent>()
//   <button v-bind="tip.on(card)">…</button>
//   <ItemTooltip v-bind="tip.props" :content="tip.content" />
//
// The default slot goes into the card, for a card of your own made of the item card's parts.
import type { TooltipContent } from "@tavora/sdk"
import { computed } from "vue"
import Tooltip, { type TooltipDismissReason } from "../../tooltip/Tooltip"
import type { TooltipPoint, TooltipRect, TooltipSide } from "../../tooltip/geometry"
import type { ItemCardSkin } from "."
import { layoutOf, skinColored } from "./content"
import ItemCard from "./ItemCard.vue"

const props = withDefaults(
  defineProps<{
    open: boolean
    /** The card; nothing shows without one. */
    content?: TooltipContent | null
    /** The box of the thing the card is for. */
    anchor?: TooltipRect
    /** Only a pointer position: the card keeps clear of the cursor. Use `anchor` when you have the element. */
    at?: TooltipPoint
    side?: TooltipSide
    id?: string
    skin?: ItemCardSkin
    /** The heading over `requirements` ("Requires"), in the user's language. */
    requiresLabel?: string
    /** Pinned open (useTooltip's `pin`): it takes the pointer and shows a close X; see Tooltip. */
    pinned?: boolean
    /** The tallest the card gets before it scrolls, in pixels; see Tooltip. */
    maxHeight?: number
  }>(),
  { content: null, side: "bottom" },
)
const emit = defineEmits<{ dismiss: [reason?: TooltipDismissReason] }>()

// As wide as the layout gets in the shared tooltip: a card 280 px, a unit and the rich layout up to 520 px.
const width = computed(() => {
  const layout = props.content ? layoutOf(props.content) : "card"
  return layout === "card" ? "sm" : "lg"
})
// The arrow only where it takes the card's look: not on a unit (a shape of its own, no box), nor on a card in a skin's
// colours or frame. The rich layout wears no skin.
const arrow = computed(() => {
  const layout = props.content ? layoutOf(props.content) : "card"
  // The PoE look has an edge of its own colour, which the arrow can't take either.
  if (props.content?.look === "poe" && layout !== "unit" && !props.skin) return false
  return layout === "rich" || (layout === "card" && !props.skin?.frame && !skinColored(props.skin))
})
</script>

<template>
  <Tooltip :open="open && !!content" :anchor="anchor" :at="at" :side="side" :id="id" :width="width" :arrow="arrow" :pinned="pinned" :max-height="maxHeight" bare @dismiss="(reason) => emit('dismiss', reason)">
    <ItemCard v-if="content" :content="content" :skin="skin" :requires-label="requiresLabel"><slot /></ItemCard>
  </Tooltip>
</template>
