<script setup lang="ts">
// Five stars. Read-only, it shows a rating rounded to the nearest half star. Editable (v-model), it is
// a radio group of 1 to 5 stars: arrow keys move, hovering previews, and each star has its own label.
import type { HTMLAttributes } from "vue"
import { StarIcon } from "@lucide/vue"
import { RadioGroupItem, RadioGroupRoot } from "reka-ui"
import { computed, ref } from "vue"
import { controlSize, type ControlSize, type ControlSizeAlias } from "../../../lib/control-size"
import { cn } from "../../../lib/utils"
import { roundToHalf } from "./round"

const props = withDefaults(
  defineProps<{
    /** The rating, 0 to 5. Read-only shows it to the nearest half; editable takes whole stars. */
    modelValue?: number
    /** Lets the user pick 1 to 5 stars. */
    editable?: boolean
    /** Read-only: what the stars say, such as "4.7 out of 5 stars". Editable: the group's name. */
    label: string
    /** Editable: each star's label, such as "3 stars". */
    starLabel?: (stars: number) => string
    /** The kit's size scale. `md` is the old name of `default`, read for one round. */
    size?: ControlSize | ControlSizeAlias
    disabled?: boolean
    class?: HTMLAttributes["class"]
  }>(),
  { modelValue: 0, size: "default" },
)
const emit = defineEmits<{ "update:modelValue": [value: number] }>()

const hovered = ref<number | null>(null)
const shown = computed(() => (props.editable ? (hovered.value ?? Math.round(props.modelValue)) : roundToHalf(props.modelValue)))
const STAR_SIZE: Record<ControlSize, string> = { sm: "size-3.5", default: "size-4", lg: "size-6" }
const starSize = computed(() => STAR_SIZE[controlSize(props.size)])
const fill = (star: number) => (shown.value >= star ? "full" : shown.value >= star - 0.5 ? "half" : "empty")
</script>

<template>
  <span v-if="!editable" data-slot="star-rating" role="img" :aria-label="label" :class="cn('text-primary inline-flex items-center gap-0.5', props.class)">
    <span v-for="star in 5" :key="star" class="relative inline-flex" :data-fill="fill(star)">
      <StarIcon :class="cn(starSize, 'text-muted-foreground/40')" />
      <span v-if="fill(star) !== 'empty'" class="absolute inset-y-0 left-0 overflow-hidden" :class="fill(star) === 'half' ? 'w-1/2' : 'w-full'">
        <StarIcon :class="cn(starSize, 'fill-current')" />
      </span>
    </span>
  </span>
  <RadioGroupRoot
    v-else
    data-slot="star-rating"
    :model-value="modelValue ? String(Math.round(modelValue)) : undefined"
    :aria-label="label"
    :disabled="disabled"
    orientation="horizontal"
    :class="cn('text-primary inline-flex items-center gap-0.5', props.class)"
    @update:model-value="(value) => emit('update:modelValue', Number(value))"
    @mouseleave="hovered = null"
  >
    <RadioGroupItem
      v-for="star in 5"
      :key="star"
      :value="String(star)"
      :aria-label="starLabel ? starLabel(star) : String(star)"
      :data-fill="fill(star)"
      class="focus-visible:ring-ring/50 rounded-sm p-0.5 outline-none transition-transform focus-visible:ring-3 enabled:hover:scale-110 disabled:cursor-not-allowed disabled:opacity-(--disabled-opacity)"
      @mouseenter="!disabled && (hovered = star)"
    >
      <StarIcon :class="cn(starSize, fill(star) === 'full' ? 'fill-current' : 'text-muted-foreground/40')" />
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
