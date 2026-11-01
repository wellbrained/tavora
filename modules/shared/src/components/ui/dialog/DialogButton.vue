<script setup lang="ts">
// A button for a dialog's footer. Buttons that do something (Save, Import, Delete…) may carry an `icon`; buttons
// that only close the dialog (Cancel, Close, Done, OK) are marked `close` and never show one, even when they are
// the primary button. A close button is secondary unless you give it a `variant`; an action is primary.
import type { Component, HTMLAttributes } from "vue"
import { Loader2 } from "@lucide/vue"
import { cn } from "../../../lib/utils"
import { Button } from "../button"
import type { ButtonVariants } from "../button"

const props = defineProps<{
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  class?: HTMLAttributes["class"]
  /** The button only closes the dialog: it never carries an icon. */
  close?: boolean
  /** The icon of an action. Ignored on a close button. */
  icon?: Component
  /** Swaps the icon for a spinner (an action that is running). Ignored on a close button. */
  loading?: boolean
}>()
</script>

<template>
  <Button
    :variant="variant ?? (close ? 'secondary' : 'default')"
    :size="size"
    :data-dialog-button="close ? 'close' : 'action'"
    :class="cn(close && '[&_svg]:hidden', props.class)"
  >
    <template v-if="!close">
      <Loader2 v-if="loading" class="animate-spin motion-reduce:animate-none" :stroke-width="1.5" aria-hidden="true" />
      <component :is="icon" v-else-if="icon" :stroke-width="1.5" aria-hidden="true" />
    </template>
    <slot />
  </Button>
</template>
