<script setup lang="ts">
// A unit's title bar: the title, and the corner value at the right (`corner`) with its pictogram drawn as a mask.
import type { TooltipContent } from "@tavora/sdk"
import { computed } from "vue"
import { maskUrl } from "../content"

const props = defineProps<{ content: TooltipContent }>()
const cornerIcon = computed(() => maskUrl(props.content.corner?.icon))
</script>

<template>
  <div class="tavora-item-card-bar">
    <h3>{{ content.title }}</h3>
    <span v-if="content.corner" class="tavora-item-card-corner">
      <span>{{ content.corner.text }}</span>
      <span v-if="cornerIcon" class="tavora-item-card-corner-icon" aria-hidden="true" :style="{ '--ic-icon': cornerIcon }" />
    </span>
  </div>
</template>
