<script setup lang="ts">
// A unit's pips (`pips`): diamonds on the bottom edge, the first ones filled (a level, stars), and the extra text under them.
// Screen readers hear "3 of 5" (and the extra text) in the language shown.
import type { TooltipContent } from "@tavora/sdk"
import { computed } from "vue"
import { uiText } from "../../text"

const props = defineProps<{ content: TooltipContent }>()
const label = computed(() => {
  const pips = props.content.pips
  if (!pips) return ""
  const text = pips.extra ? uiText.value.pipsExtra.replace("{extra}", pips.extra) : uiText.value.pips
  return text.replace("{filled}", String(pips.filled)).replace("{total}", String(pips.total))
})
</script>

<template>
  <template v-if="content.pips">
    <div class="tavora-item-card-pips" role="img" :aria-label="label">
      <span v-for="i in content.pips.total" :key="i" class="tavora-item-card-pip" :data-on="i <= content.pips.filled ? '' : undefined" />
    </div>
    <div v-if="content.pips.extra" class="tavora-item-card-extra" aria-hidden="true">{{ content.pips.extra }}</div>
  </template>
</template>
