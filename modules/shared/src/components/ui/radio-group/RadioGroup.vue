<script setup lang="ts">
import type { RadioGroupRootEmits, RadioGroupRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { RadioGroupRoot, useForwardPropsEmits } from "reka-ui"
import { useKeyTravel } from "../../../lib/key-travel"
import { cn } from "../../../lib/utils"

const props = defineProps<RadioGroupRootProps & { class?: HTMLAttributes["class"] }>()
const emits = defineEmits<RadioGroupRootEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
// Moving through the options with the arrow keys picks them without animating; a click or Space does animate.
const travel = useKeyTravel()
</script>

<template>
  <RadioGroupRoot
    v-slot="slotProps"
    data-slot="radio-group"
    :data-travel="travel.travelling.value ? '' : undefined"
    :class="cn('grid gap-3', props.class)"
    v-bind="forwarded"
    @keydown.capture="travel.onKeydown"
    @keyup="travel.end"
    @pointerdown.capture="travel.end"
    @focusout="travel.onFocusout"
  >
    <slot v-bind="slotProps" />
  </RadioGroupRoot>
</template>
