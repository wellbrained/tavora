<script setup lang="ts">
// A unit's stats: label, the value lined up on its right edge, and the suffix (`suffix`) hanging past it.
import type { TooltipContent } from "@tavora/sdk"

defineProps<{ content: TooltipContent }>()
</script>

<template>
  <div v-if="content.properties?.length" class="tavora-item-card-unit-stats">
    <template v-for="(p, i) in content.properties" :key="i"><span>{{ p.label }}</span><span class="tavora-item-card-unit-value">{{ p.value }}</span><span class="tavora-item-card-unit-suffix">{{ p.suffix ?? "" }}</span></template>
  </div>
</template>
