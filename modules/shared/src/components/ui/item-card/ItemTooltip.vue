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
import Tooltip from "../../tooltip/Tooltip"
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
  }>(),
  { content: null, side: "bottom" },
)
const emit = defineEmits<{ dismiss: [] }>()

// As wide as the layout gets in the shared tooltip: a card 280 px, a unit up to 520 px, the rich layout in between.
const width = computed(() => {
  const layout = props.content ? layoutOf(props.content) : "card"
  return layout === "unit" ? "lg" : layout === "rich" ? "md" : "sm"
})
// The arrow only where it takes the card's look: not on a unit (a shape of its own, no box), nor on a card in a skin's
// colours or frame. The rich layout wears no skin.
const arrow = computed(() => {
  const layout = props.content ? layoutOf(props.content) : "card"
  return layout === "rich" || (layout === "card" && !props.skin?.frame && !skinColored(props.skin))
})
</script>

<template>
  <Tooltip :open="open && !!content" :anchor="anchor" :at="at" :side="side" :id="id" :width="width" :arrow="arrow" bare @dismiss="emit('dismiss')">
    <ItemCard v-if="content" :content="content" :skin="skin" :requires-label="requiresLabel"><slot /></ItemCard>
  </Tooltip>
</template>
