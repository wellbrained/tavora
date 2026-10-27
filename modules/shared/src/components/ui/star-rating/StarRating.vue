<script setup lang="ts">
// Five stars. Read-only, it shows a rating rounded to the nearest half star. Editable (v-model), it is
// a radio group of 1 to 5 stars: arrow keys move, hovering previews, and each star has its own label.
import type { HTMLAttributes } from "vue"
import { StarIcon } from "@lucide/vue"
import { RadioGroupItem, RadioGroupRoot } from "reka-ui"
import { computed, ref } from "vue"
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
    size?: "sm" | "md" | "lg"
    disabled?: boolean
    class?: HTMLAttributes["class"]
  }>(),
  { modelValue: 0, size: "md" },
)
const emit = defineEmits<{ "update:modelValue": [value: number] }>()

const hovered = ref<number | null>(null)
const shown = computed(() => (props.editable ? (hovered.value ?? Math.round(props.modelValue)) : roundToHalf(props.modelValue)))
const sizes = { sm: "size-3.5", md: "size-4", lg: "size-6" } as const
const fill = (star: number) => (shown.value >= star ? "full" : shown.value >= star - 0.5 ? "half" : "empty")
</script>

<template>
  <span v-if="!editable" data-slot="star-rating" role="img" :aria-label="label" :class="cn('text-primary inline-flex items-center gap-0.5', props.class)">
    <span v-for="star in 5" :key="star" class="relative inline-flex" :data-fill="fill(star)">
      <StarIcon :class="cn(sizes[size], 'text-muted-foreground/40')" :stroke-width="1.5" />
      <span v-if="fill(star) !== 'empty'" class="absolute inset-y-0 left-0 overflow-hidden" :class="fill(star) === 'half' ? 'w-1/2' : 'w-full'">
        <StarIcon :class="cn(sizes[size], 'fill-current')" :stroke-width="1.5" />
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
      class="focus-visible:ring-ring/50 rounded-sm p-0.5 outline-none transition-transform focus-visible:ring-3 enabled:hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50"
      @mouseenter="!disabled && (hovered = star)"
    >
      <StarIcon :class="cn(sizes[size], fill(star) === 'full' ? 'fill-current' : 'text-muted-foreground/40')" :stroke-width="1.5" />
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
