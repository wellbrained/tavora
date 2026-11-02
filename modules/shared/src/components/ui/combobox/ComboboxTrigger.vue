<script setup lang="ts">
import type { ComboboxTriggerProps } from "reka-ui"
import { ChevronDown } from "@lucide/vue"
import { ComboboxTrigger, useForwardProps } from "reka-ui"
import { Button } from "../button"
import { uiText } from "../text"

// The chevron at the end of a field with a list (a ComboboxInput inside the same ComboboxAnchor): it opens the list, which
// starts at the field's left edge. A button that opens a list of suggestions has the single down arrow.
const props = defineProps<ComboboxTriggerProps & { label?: string }>()
const forwarded = useForwardProps(props)
</script>

<template>
  <ComboboxTrigger data-slot="combobox-trigger" v-bind="forwarded" as-child>
    <Button type="button" size="icon-xs" variant="ghost" class="text-muted-foreground absolute top-1/2 right-1.5 -translate-y-1/2" :aria-label="label ?? uiText.showList" :title="label ?? uiText.showList" @mousedown.prevent>
      <ChevronDown :stroke-width="1.5" aria-hidden="true" />
    </Button>
  </ComboboxTrigger>
</template>
