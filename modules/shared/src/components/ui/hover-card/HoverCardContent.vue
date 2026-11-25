<script setup lang="ts">
// The card of a HoverCard: the tooltip's surface, arrow and type, but you can move into it, click in it and Tab
// through it. Pinned, it shows a close X in its corner and becomes a small dialog named after its title.
import { X } from "@lucide/vue"
import { PopoverArrow, PopoverContent, PopoverPortal } from "reka-ui"
import { computed, onBeforeUnmount, watch } from "vue"
import { tooltipMaxWidth, type TooltipWidth } from "../../tooltip/Tooltip"
import type { TooltipSide } from "../../tooltip/geometry"
import "../../tooltip/tooltip.css"
import "./hover-card.css"
import { Button } from "../button"
import { uiText } from "../text"
import { injectHoverCard } from "./context"

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  /** Where the card goes when there is room. One card for many targets takes the side its target asked for. */
  side?: TooltipSide
  align?: "start" | "center" | "end"
  /** How wide the card may get: `sm` (280 px), `md`, `lg` or pixels. It never gets wider than the window. */
  width?: TooltipWidth
  /** For an item card or anything with its own surface: no padding, background or edge of its own. */
  bare?: boolean
  /** The arrow pointing at the target. */
  arrow?: boolean
  /** A name for the pinned card when it has no `title`, read by screen readers. */
  label?: string
}>(), { align: "center", width: "sm", arrow: true })

const controller = injectHoverCard("HoverCardContent")
const titleId = `${controller.id}-title`

const side = computed(() => props.side ?? controller.side)
// The width it may take, and never wider than the window allows (reka tells us how much room there is).
const maxWidth = computed(() => props.bare ? undefined : `min(${tooltipMaxWidth(props.width)}px, var(--reka-popper-available-width, 100vw), calc(100vw - 16px))`)

// Reka's popover names its own content (an id, `role="dialog"`, a label from a trigger it doesn't have here) after
// anything passed in, so the card's own names go on once it is drawn. Reka sets each only once, so they stay.
const names = computed(() => controller.pinned
  ? { role: "dialog", "aria-modal": "false", "aria-labelledby": props.title ? titleId : null, "aria-label": props.title ? null : props.label ?? null }
  : { role: "group", "aria-modal": null, "aria-labelledby": props.title ? titleId : null, "aria-label": props.title ? null : props.label ?? null })
function name(el: HTMLElement | null) {
  if (!el) return
  el.id = controller.id
  for (const [attribute, value] of Object.entries(names.value)) {
    if (value === null) el.removeAttribute(attribute)
    else el.setAttribute(attribute, value)
  }
}
watch(names, () => name(controller.surface.element), { flush: "post" })
// The helper needs the card's element for Tab and to tell it from outside: a hidden marker at its end reports it as
// the card is drawn and taken away (Reka draws it a moment after it opens).
function marker(el: unknown) {
  const card = el instanceof HTMLElement ? el.closest<HTMLElement>("[data-slot=hover-card]") : null
  controller.surface.attach(card)
  name(card)
}
// Hovering never moves the focus, and the helper gives it back itself on Escape and the close button.
const prevent = (event: Event) => event.preventDefault()
onBeforeUnmount(() => controller.surface.attach(null))

function dismiss(reason: "escape" | "outside-press" | "focus-outside", event: Event) {
  if (reason === "escape") {
    // The key stays the page's: the card only closes (and gives the focus back), as Reka would close it anyway.
    controller.surface.dismiss(reason, null)
    return
  }
  // The helper decides: a press on one of the card's targets or the focus going back to it keeps the card.
  event.preventDefault()
  const original = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent
  controller.surface.dismiss(reason, original?.target ?? null)
}
</script>

<template>
  <PopoverPortal>
    <PopoverContent
      data-slot="hover-card"
      :data-pinned="controller.pinned ? 'true' : undefined"
      :data-bare="bare ? 'true' : undefined"
      :side="side"
      :align="align"
      :side-offset="arrow && !bare ? 5 : 10"
      :collision-padding="8"
      :arrow-padding="10"
      :class="['tavora-tooltip tavora-hover-card', { 'tavora-hover-card-pinned': controller.pinned }]"
      :style="{ maxWidth }"
      @open-auto-focus="prevent"
      @close-auto-focus="prevent"
      @escape-key-down="dismiss('escape', $event)"
      @pointer-down-outside="dismiss('outside-press', $event)"
      @focus-outside="dismiss('focus-outside', $event)"
    >
      <template v-if="title || description">
        <div class="tavora-tooltip-head">
          <div :id="titleId" class="tavora-tooltip-title">{{ title }}</div>
        </div>
        <p v-if="description">{{ description }}</p>
      </template>
      <slot :content="controller.content" :pinned="controller.pinned" :close="controller.close" />
      <Button v-if="controller.pinned" variant="ghost" size="icon-xs" data-slot="hover-card-x" class="tavora-hover-card-close" :aria-label="uiText.close" @click="controller.close({ returnFocus: true })">
        <X aria-hidden="true" />
      </Button>
      <PopoverArrow v-if="arrow && !bare" as-child>
        <svg class="tavora-hover-card-arrow" width="12" height="7" viewBox="0 0 12 7" aria-hidden="true"><path d="M0 0.5 L6 6.5 L12 0.5" /></svg>
      </PopoverArrow>
      <span :ref="marker" hidden aria-hidden="true" />
    </PopoverContent>
  </PopoverPortal>
</template>
