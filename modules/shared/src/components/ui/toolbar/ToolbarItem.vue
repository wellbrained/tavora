<script setup lang="ts">
// One stop of a Toolbar's arrow keys, around a control's own element (no element of its own). Kit controls put it
// around themselves while `join` is on; with `join` off it only passes its content through, still as one element, so
// a template ref's `$el` stays the control's element.
import { Primitive, RovingFocusItem } from "reka-ui"

withDefaults(defineProps<{ join: boolean; focusable?: boolean }>(), { focusable: true })
</script>

<template>
  <component :is="join ? RovingFocusItem : Primitive" as-child v-bind="join ? { focusable, 'data-toolbar-item': '' } : {}">
    <slot />
  </component>
</template>
