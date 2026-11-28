<script setup lang="ts">
// Without props this is the plain header (put a DialogTitle and DialogDescription in it). With `title` it is the
// kit's header: a top row with an optional icon box, the title (centred on the icon, or on the X without one) and
// the close X, both at the top. The description and anything in the default slot go in a row of their own under it,
// full width and 18px below, with or without an icon; never beside the icon.
import type { Component, HTMLAttributes } from "vue"
import { inject, onBeforeUnmount, watchEffect } from "vue"
import { cn } from "../../../lib/utils"
import { dialogChromeKey, dialogCloseClass } from "./chrome"
import DialogCloseX from "./DialogCloseX.vue"
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
// The header draws the close X itself, so it sits at the top of the title row and not in the corner.
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
    :class="cn('grid items-start gap-x-3 gap-y-1 text-left', icon ? 'grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]', props.class)"
  >
    <span
      v-if="icon"
      data-slot="dialog-icon"
      class="bg-foreground/9 text-foreground flex size-[42px] shrink-0 items-center justify-center rounded-[calc(var(--radius)+2px)]"
      aria-hidden="true"
    >
      <component :is="icon" class="size-[19px]" />
    </span>
    <div :class="cn('flex min-w-0 items-center', icon ? 'min-h-[42px]' : 'min-h-[30px]')">
      <DialogTitle class="leading-snug">{{ title }}</DialogTitle>
    </div>
    <DialogCloseX v-if="chrome?.showClose.value" :class="dialogCloseClass" />
    <div v-if="description || $slots.default" class="col-span-full mt-3.5 flex min-w-0 flex-col gap-1">
      <DialogDescription v-if="description">{{ description }}</DialogDescription>
      <slot />
    </div>
  </div>
</template>
