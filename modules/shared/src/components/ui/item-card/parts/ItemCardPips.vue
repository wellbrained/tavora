<script setup lang="ts">
// A unit's pips (`pips`): diamonds on the bottom edge, the first ones filled (a level, stars), and the extra text under them.
import type { TooltipContent } from "@tavora/sdk"

defineProps<{ content: TooltipContent }>()
</script>

<template>
  <template v-if="content.pips">
    <div class="tavora-item-card-pips" role="img" :aria-label="`${content.pips.filled} / ${content.pips.total}${content.pips.extra ? ' ' + content.pips.extra : ''}`">
      <span v-for="i in content.pips.total" :key="i" class="tavora-item-card-pip" :data-on="i <= content.pips.filled ? '' : undefined" />
    </div>
    <div v-if="content.pips.extra" class="tavora-item-card-extra" aria-hidden="true">{{ content.pips.extra }}</div>
  </template>
</template>
