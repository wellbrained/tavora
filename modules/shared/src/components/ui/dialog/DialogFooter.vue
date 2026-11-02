<script setup lang="ts">
// The buttons under a dialog's content, bottom right, the action last. No line above them: the gap is the same
// as the one between header and content. Use DialogButton for the buttons (an action may have an icon, a close
// button never does).
import type { HTMLAttributes } from "vue"
import { DialogClose } from "reka-ui"
import { cn } from "../../../lib/utils"
import { uiText } from "../text"
import DialogButton from "./DialogButton.vue"

const props = withDefaults(defineProps<{
  class?: HTMLAttributes["class"]
  showCloseButton?: boolean
}>(), {
  showCloseButton: false,
})
</script>

<template>
  <div
    data-slot="dialog-footer"
    :class="cn('flex flex-row flex-wrap items-center justify-end gap-2', props.class)"
  >
    <slot />
    <DialogClose v-if="showCloseButton" as-child>
      <DialogButton close>
        {{ uiText.close }}
      </DialogButton>
    </DialogClose>
  </div>
</template>
