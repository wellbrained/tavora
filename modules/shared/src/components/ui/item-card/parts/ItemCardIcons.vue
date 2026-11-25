<script setup lang="ts">
// A unit's row of small framed pictures (`icons`: spells, buffs, items it carries), each with a count at its corner.
import type { TooltipContent } from "@tavora/sdk"

defineProps<{ content: TooltipContent }>()
</script>

<template>
  <div v-if="content.icons?.length" class="tavora-item-card-icons">
    <span v-for="(icon, i) in content.icons" :key="i" class="tavora-item-card-unit-icon" role="img" :aria-label="icon.count ? `${icon.label} (${icon.count})` : icon.label">
      <img v-if="icon.image" :src="icon.image" alt="" />
      <span v-if="icon.count" class="tavora-item-card-count" aria-hidden="true">{{ icon.count }}</span>
    </span>
  </div>
</template>
