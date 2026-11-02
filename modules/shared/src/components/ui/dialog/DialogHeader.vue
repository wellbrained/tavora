<script setup lang="ts">
// Without props this is the plain header (put a DialogTitle and DialogDescription in it). With `title` it is the
// kit's header: an optional icon box, the title with an optional one-line description under it, and the close X
// on the right, all centred against each other. Anything in the default slot goes under the description.
import type { Component, HTMLAttributes } from "vue"
import { X } from "@lucide/vue"
import { DialogClose } from "reka-ui"
import { inject, onBeforeUnmount, watchEffect } from "vue"
import { cn } from "../../../lib/utils"
import { uiText } from "../text"
import { dialogChromeKey, dialogCloseClass } from "./chrome"
import DialogDescription from "./DialogDescription.vue"
import DialogTitle from "./DialogTitle.vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
  /** A Lucide icon, shown in a soft box in front of the title. */
  icon?: Component
  title?: string
  /** One short line under the title. */
  description?: string
}>()

const chrome = inject(dialogChromeKey, null)
// The header draws the close X itself, so it sits centred against the title and not in the corner.
watchEffect(() => {
  if (chrome) chrome.headerClose.value = props.title !== undefined
})
onBeforeUnmount(() => {
  if (chrome) chrome.headerClose.value = false
})
</script>

<template>
  <div
    v-if="title === undefined"
    data-slot="dialog-header"
    :class="cn('flex flex-col gap-2 text-left', props.class)"
  >
    <slot />
  </div>
  <div
    v-else
    data-slot="dialog-header"
    :class="cn('flex items-center gap-3 text-left', props.class)"
  >
    <span
      v-if="icon"
      data-slot="dialog-icon"
      class="bg-foreground/9 text-foreground flex size-[42px] shrink-0 items-center justify-center rounded-[calc(var(--radius)+2px)]"
      aria-hidden="true"
    >
      <component :is="icon" class="size-[19px]" :stroke-width="1.5" />
    </span>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <DialogTitle class="leading-snug">{{ title }}</DialogTitle>
      <DialogDescription v-if="description">{{ description }}</DialogDescription>
      <slot />
    </div>
    <DialogClose v-if="chrome?.showClose.value" data-slot="dialog-close" :class="dialogCloseClass">
      <X :stroke-width="1.5" />
      <span class="sr-only">{{ uiText.close }}</span>
    </DialogClose>
  </div>
</template>
