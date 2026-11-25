<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import type { ChipVariants } from "."
import { Check, X } from "@lucide/vue"
import { computed } from "vue"
import { cn } from "../../../lib/utils"
import { uiText } from "../text"
import { chipRemoveSize, chipToggle, chipVariants } from "."

// A tag the user can act on. Three kinds, by props:
// - plain: a word with an optional icon or colour dot in front (`icon` slot), like a Badge.
// - `removable`: a × after the word sends `remove`. Its name is "Remove <label>" (or `remove-label`).
// - `toggle`: the whole chip is a button that switches `selected` (a filter pill); on shows a check. A toggle chip has no ×.
// `marked` rings the chip: TagInput marks the one Backspace or Delete would remove.
const props = withDefaults(defineProps<{
  variant?: ChipVariants["variant"]
  size?: ChipVariants["size"]
  /** The chip's word; the default slot replaces it. Also names the × for screen readers. */
  label?: string
  removable?: boolean
  removeLabel?: string
  /** Whether Tab reaches the ×; TagInput turns it off (its chips are reached with the keys). */
  removeTabbable?: boolean
  toggle?: boolean
  selected?: boolean
  disabled?: boolean
  marked?: boolean
  class?: HTMLAttributes["class"]
}>(), {
  variant: "secondary",
  size: "default",
  removeTabbable: true,
})

const emit = defineEmits<{
  "remove": []
  "update:selected": [selected: boolean]
}>()

const size = computed(() => props.size ?? "default")
const canRemove = computed(() => props.removable && !props.toggle)
const removeName = computed(() => props.removeLabel ?? (props.label ? uiText.value.removeTag.replace("{tag}", props.label) : uiText.value.remove))

const classes = computed(() => cn(
  chipVariants({ variant: props.toggle ? null : props.variant, size: size.value, removable: canRemove.value }),
  props.toggle && (props.selected ? chipToggle.on : chipToggle.off),
  props.toggle && "outline-none focus-visible:ring-ring/50 focus-visible:ring-2 disabled:cursor-not-allowed",
  props.marked && "ring-ring ring-2",
  props.class,
))

function flip() {
  if (!props.disabled) emit("update:selected", !props.selected)
}

function remove() {
  if (!props.disabled) emit("remove")
}
</script>

<template>
  <button
    v-if="toggle"
    type="button"
    data-slot="chip"
    :data-size="size"
    :data-state="selected ? 'on' : 'off'"
    :aria-pressed="selected ? 'true' : 'false'"
    :disabled="disabled"
    :class="classes"
    @click="flip"
  >
    <Check v-if="selected" aria-hidden="true" />
    <slot name="icon" />
    <span class="min-w-0 truncate"><slot>{{ label }}</slot></span>
  </button>
  <span
    v-else
    data-slot="chip"
    :data-size="size"
    :data-marked="marked ? '' : undefined"
    :data-disabled="disabled ? '' : undefined"
    :class="classes"
  >
    <slot name="icon" />
    <span class="min-w-0 truncate"><slot>{{ label }}</slot></span>
    <button
      v-if="canRemove"
      type="button"
      data-slot="chip-remove"
      :class="cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm opacity-70 outline-none hover:bg-[color-mix(in_srgb,currentColor_15%,transparent)] hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none',
        chipRemoveSize[size],
      )"
      :aria-label="removeName"
      :title="removeName"
      :tabindex="removeTabbable ? undefined : -1"
      :disabled="disabled"
      @click.stop="remove"
    >
      <X aria-hidden="true" />
    </button>
  </span>
</template>
