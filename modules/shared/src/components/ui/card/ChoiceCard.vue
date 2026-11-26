<script setup lang="ts">
// One option of a `RadioGroup`, drawn as a card: an optional picture (`media`), a title, a line under it and anything else
// in the default slot. The picked card shows it by its edge and fill; there is no radio mark. It is a radio, so the
// arrow keys move between the cards and Space picks. Put several in a `RadioGroup`, which lays them out (give it
// `class="grid-cols-2"` or similar). To pick several, use `CheckCard`.
import type { HTMLAttributes } from "vue"
import { RadioGroupItem } from "reka-ui"
import { cn } from "../../../lib/utils"
import { DIP_PRESS } from "../button"
import { CARD_BASE, CARD_INTERACTIVE, CARD_PADDING, CARD_SELECTED, type CardSize } from "./look"

const props = withDefaults(defineProps<{
  value: string
  title: string
  description?: string
  size?: CardSize
  disabled?: boolean
  class?: HTMLAttributes["class"]
}>(), { size: "default" })
</script>

<template>
  <RadioGroupItem
    data-slot="choice-card"
    :value="value"
    :disabled="disabled"
    :class="cn(
      'tavora-quiet-travel',
      CARD_BASE,
      CARD_PADDING[size],
      CARD_INTERACTIVE,
      !disabled && DIP_PRESS,
      'data-[state=checked]:border-primary data-[state=checked]:bg-primary/10 data-[state=checked]:hover:border-primary data-[state=checked]:hover:bg-primary/15',
      props.class,
    )"
  >
    <span v-if="$slots.media" data-slot="choice-card-media" class="bg-muted relative block aspect-[16/9] w-full overflow-hidden rounded-md" aria-hidden="true"><slot name="media" /></span>
    <span data-slot="choice-card-title" class="text-sm leading-5 font-medium">{{ title }}</span>
    <span v-if="description" data-slot="choice-card-description" class="text-muted-foreground text-xs">{{ description }}</span>
    <slot />
  </RadioGroupItem>
</template>
