<script setup lang="ts">
// A button for a dialog's footer. Buttons that do something (Save, Import, Delete…) may carry an `icon`; buttons
// that only close the dialog (Cancel, Close, Done, OK) are marked `close` and never show one, even when they are
// the primary button. A close button is secondary unless you give it a `variant`; an action is primary.
// The work behind it goes in `action`, as on a Button: busy while it runs, no second press, a spinner, and the kit's
// error toast when it fails. `busy` is for work you track yourself: the icon turns into the spinner and a press does
// nothing until it is done.
import type { Component, HTMLAttributes } from "vue"
import { LoaderCircle } from "@lucide/vue"
import { computed } from "vue"
import { stopSoft } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"
import { Button, type ButtonAction } from "../button"
import type { ButtonVariants } from "../button"

const props = defineProps<{
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  class?: HTMLAttributes["class"]
  /** The button only closes the dialog: it never carries an icon. */
  close?: boolean
  /** The icon of an action. Ignored on a close button. */
  icon?: Component
  /** The work behind the button, as on a Button (see `action.ts`). Ignored on a close button. */
  action?: ButtonAction
  /** Shown with a check for 2 s when the action worked ("Saved"). */
  doneLabel?: string
  /** Shown with the spinner when the action runs longer than 1 s ("Saving…"). */
  busyLabel?: string
  /** Work you track yourself is running: the icon turns into a spinner and a press does nothing. Ignored on a close button. */
  busy?: boolean
  /** @deprecated The old name of `busy`, read for one round. */
  loading?: boolean
}>()

const running = computed(() => !props.close && (props.busy || props.loading))

// While busy, a press does nothing: the click never reaches a handler, a form or a dialog close around it. The listener
// is only there while busy (an extra click listener makes Vue drop a click on a button that appeared that millisecond).
</script>

<template>
  <Button
    :variant="variant ?? (close ? 'secondary' : 'default')"
    :size="size"
    :action="close ? undefined : action"
    :done-label="doneLabel"
    :busy-label="busyLabel"
    :data-dialog-button="close ? 'close' : 'action'"
    :type="close ? 'button' : undefined"
    v-bind="running ? { 'aria-busy': 'true', onClickCapture: stopSoft } : {}"
    :class="cn(close && '[&_svg]:hidden', running && 'cursor-progress', props.class)"
  >
    <template v-if="!close">
      <LoaderCircle v-if="running" class="tavora-spin" aria-hidden="true" />
      <component :is="icon" v-else-if="icon" aria-hidden="true" />
    </template>
    <slot />
  </Button>
</template>
