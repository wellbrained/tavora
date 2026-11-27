<script setup lang="ts">
// What the item needs (`requirements`), under `label` ("Requires", in the user's language): in the stats' columns on a
// card, under the picture in the rich layout (`rich`), as the shared tooltip shows them.
import type { TooltipContent } from "@tavora/sdk"

defineProps<{ content: TooltipContent; label?: string; rich?: boolean }>()
</script>

<template>
  <div v-if="rich && content.requirements?.length" class="tavora-item-card-requirements">
    <p v-if="label">{{ label }}</p>
    <dl><template v-for="(r, i) in content.requirements" :key="i"><dt>{{ r.label }}</dt><dd>{{ r.value }}</dd></template></dl>
  </div>
  <section v-else-if="!rich && content.requirements?.length" class="tavora-item-card-section">
    <p v-if="label">{{ label }}</p>
    <div class="tavora-item-card-stats"><template v-for="(r, i) in content.requirements" :key="i"><span class="tavora-item-card-label">{{ r.label }}</span><span class="tavora-item-card-value">{{ r.value }}</span></template></div>
  </section>
</template>
