<script setup lang="ts">
// What the item needs (`requirements`), under `label` ("Requires", in the user's language): in the stats' columns on a
// card, as a list in the rich layout (`rich`).
import type { TooltipContent } from "@tavora/sdk"

defineProps<{ content: TooltipContent; label?: string; rich?: boolean }>()
</script>

<template>
  <section v-if="content.requirements?.length" class="tavora-item-card-section">
    <p v-if="label">{{ label }}</p>
    <dl v-if="rich" class="tavora-item-card-props"><template v-for="(r, i) in content.requirements" :key="i"><dt>{{ r.label }}</dt><dd>{{ r.value }}</dd></template></dl>
    <div v-else class="tavora-item-card-stats"><template v-for="(r, i) in content.requirements" :key="i"><span class="tavora-item-card-label">{{ r.label }}</span><span class="tavora-item-card-value">{{ r.value }}</span></template></div>
  </section>
</template>
