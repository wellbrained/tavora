<script setup lang="ts">
// One row of a palette's list (or a Listbox): a ListRow that is a listbox option. Room for an icon in front (`icon`,
// muted and sized for the row; the `leading` slot for a picture or a game's tile), the label, a second line
// (`description`) and a hint at the end (`trailing`: a kind, "Appearance", "2 modules"). `active` is the lit row the
// arrow keys and Enter work on (it says `aria-selected`, as a combobox list does); `busy` while the pick is being done:
// a spinner in place of the hint, the row stays lit and pulses. `disabled` rows stay in the list, dimmed. `chosen`
// marks the row that is picked now (a Listbox's v-model). With `label` the row writes its own label and bolds where
// `match` (the search) is found in it. The owner keeps the highlight and the clicks: hover and click handlers go on the
// row as attributes.
import { Loader } from "@lucide/vue"
import { computed, type Component, type HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { choiceHighlighted, choiceRow } from "../choice-row"
import { ListRow } from "../list-row"
import { matchParts } from "../listbox/listbox"

const props = withDefaults(defineProps<{
  active?: boolean
  busy?: boolean
  disabled?: boolean
  /** The row is the one picked now: a primary tint and edge, `aria-checked`. Leave it out in a list nothing stays picked in. */
  chosen?: boolean
  /** An icon in front, muted; the `leading` slot takes its place for anything else. */
  icon?: Component
  /** The row's text, when there is no default slot. */
  label?: string
  /** The search, whose first match in `label` is bold. */
  match?: string
  /** `lg` for a palette (H + 8, bigger icons); `default` for a Listbox in a panel. */
  size?: "default" | "lg"
  class?: HTMLAttributes["class"]
}>(), { active: false, busy: false, disabled: false, chosen: undefined, size: "lg" })
defineSlots<{ default?: () => unknown, leading?: () => unknown, description?: () => unknown, trailing?: () => unknown }>()

const parts = computed(() => matchParts(props.label ?? "", props.match ?? ""))
</script>

<template>
  <ListRow
    as="div"
    role="option"
    data-slot="palette-item"
    :size="size"
    :highlighted="active || busy"
    :aria-selected="active ? 'true' : 'false'"
    :aria-checked="chosen === undefined ? undefined : chosen"
    :aria-disabled="disabled || undefined"
    :aria-busy="busy || undefined"
    :data-disabled="disabled ? '' : undefined"
    :data-state="chosen ? 'checked' : undefined"
    :class="cn(
      'tavora-busy cursor-default gap-3 px-3 select-none',
      size === 'lg' && 'rounded-lg',
      chosen !== undefined && [choiceRow, choiceHighlighted],
      disabled && 'opacity-(--disabled-opacity)',
      !disabled && 'cursor-pointer',
      props.class,
    )"
  >
    <template v-if="$slots.leading || icon" #leading>
      <slot name="leading"><component :is="icon" :class="cn('text-muted-foreground flex-none', size === 'lg' ? 'size-5' : 'size-4')" aria-hidden="true" /></slot>
    </template>
    <slot><template v-for="(piece, n) in parts" :key="n"><b v-if="piece.match" class="font-semibold">{{ piece.text }}</b><template v-else>{{ piece.text }}</template></template></slot>
    <template v-if="$slots.description" #description><slot name="description" /></template>
    <template v-if="busy || $slots.trailing" #trailing>
      <Loader v-if="busy" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" data-slot="palette-item-spinner" />
      <slot v-else name="trailing" />
    </template>
  </ListRow>
</template>
