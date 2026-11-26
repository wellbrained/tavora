<script setup lang="ts">
// An option you can tick next to others, drawn as a card: a title, a line under it and anything else in the default slot.
// Several can be ticked, so the box stays in the corner to say it (unlike `ChoiceCard`, where one is picked and the edge
// says it). Clicking anywhere on the card ticks it.
import type { HTMLAttributes } from "vue"
import { useId } from "vue"
import { cn } from "../../../lib/utils"
import { Checkbox } from "../checkbox"
import { Label } from "../label"
import { CARD_BASE, CARD_INTERACTIVE, CARD_PADDING, CARD_SELECTED, type CardSize } from "./look"

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  title: string
  description?: string
  size?: CardSize
  disabled?: boolean
  /** Why it is off. While `disabled` it stays hoverable and focusable, and the reason shows in a tooltip beside it. */
  disabledReason?: string
  id?: string
  class?: HTMLAttributes["class"]
}>(), { size: "default" })
const model = defineModel<boolean>({ default: false })
const made = useId()
const boxId = () => props.id ?? `check-card-${made}`
</script>

<template>
  <Label
    data-slot="check-card"
    :for="boxId()"
    v-bind="$attrs"
    :data-state="model ? 'checked' : 'unchecked'"
    :class="cn(
      CARD_BASE,
      CARD_PADDING[size],
      'relative items-stretch font-normal',
      disabled ? 'cursor-not-allowed opacity-(--disabled-opacity)' : CARD_INTERACTIVE,
      model && CARD_SELECTED,
      props.class,
    )"
  >
    <Checkbox :id="boxId()" v-model="model" :disabled="disabled" :disabled-reason="disabledReason" class="absolute top-3 right-3" />
    <span data-slot="check-card-title" class="pr-6 text-sm leading-5 font-medium">{{ title }}</span>
    <span v-if="description" data-slot="check-card-description" class="text-muted-foreground text-xs">{{ description }}</span>
    <slot />
  </Label>
</template>
