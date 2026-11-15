<script setup lang="ts">
// The buttons under a dialog's content, bottom right, the action last. No line above them: the gap is the same
// as the one between header and content. Use DialogButton for the buttons (an action may have an icon, a close
// button never does).
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { uiText } from "../text"
import DialogButton from "./DialogButton.vue"
import { injectDialogDismissal } from "./dismissal"

const props = withDefaults(defineProps<{
  class?: HTMLAttributes["class"]
  showCloseButton?: boolean
}>(), {
  showCloseButton: false,
})
// The Close it adds follows the dialog's `dismissible` and `busy`, as the X does.
const dismissal = injectDialogDismissal()
</script>

<template>
  <div
    data-slot="dialog-footer"
    :class="cn('flex flex-row flex-wrap items-center justify-end gap-2', props.class)"
  >
    <slot />
    <DialogButton v-if="showCloseButton" close :disabled="dismissal.busy.value" @click="dismissal.close">
      {{ uiText.close }}
    </DialogButton>
  </div>
</template>
