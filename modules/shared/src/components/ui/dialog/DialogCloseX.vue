<script setup lang="ts">
// The close X of a kit dialog (DialogContent's corner, DialogHeader, DialogScrollContent). It closes through the
// dialog's dismissal rules (dismissal.ts) and is off while the dialog is busy. Internal to the kit: not exported.
import type { HTMLAttributes } from "vue"
import { X } from "@lucide/vue"
import { uiText } from "../text"
import { injectDialogDismissal } from "./dismissal"

defineProps<{ class?: HTMLAttributes["class"] }>()

const dismissal = injectDialogDismissal()
</script>

<template>
  <button type="button" data-slot="dialog-close" :disabled="dismissal.busy.value" :class="$props.class" @click="dismissal.close">
    <slot><X /></slot>
    <span class="sr-only">{{ uiText.close }}</span>
  </button>
</template>
