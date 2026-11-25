<script setup lang="ts">
// A unit's portrait (`image`): it sticks out at the top left over the title bar and the body.
import type { TooltipContent } from "@tavora/sdk"

defineProps<{ content: TooltipContent }>()
</script>

<template>
  <div v-if="content.image" class="tavora-item-card-portrait"><img :src="content.image" alt="" /></div>
</template>
