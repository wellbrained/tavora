<script setup lang="ts">
import type { DialogOverlayProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { DialogOverlay } from "reka-ui"
import { cn } from "../../../lib/utils"
import { injectDialogInstant } from "./instant"

const props = defineProps<DialogOverlayProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
const instant = injectDialogInstant()
</script>

<template>
  <DialogOverlay
    data-slot="dialog-overlay"
    :data-instant="instant ? '' : undefined"
    v-bind="delegatedProps"
    :class="cn('tavora-dialog-overlay fixed inset-0 z-50 bg-black/80', props.class)"
  >
    <slot />
  </DialogOverlay>
</template>
