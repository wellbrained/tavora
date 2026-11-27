<script setup lang="ts">
// A unit's row of small framed pictures (`icons`: spells, buffs, items it carries), each with a count at its corner.
// Screen readers hear each one's name and count ("Steel Coat, 95") in the language shown.
import type { TooltipContent } from "@tavora/sdk"
import { iconLabel } from "../../../tooltip/parts"

defineProps<{ content: TooltipContent }>()
</script>

<template>
  <div v-if="content.icons?.length" class="tavora-item-card-icons">
    <span v-for="(icon, i) in content.icons" :key="i" class="tavora-item-card-unit-icon" role="img" :aria-label="iconLabel(icon.label, icon.count)">
      <img v-if="icon.image" :src="icon.image" alt="" />
      <span v-if="icon.count" class="tavora-item-card-count" aria-hidden="true">{{ icon.count }}</span>
    </span>
  </div>
</template>
