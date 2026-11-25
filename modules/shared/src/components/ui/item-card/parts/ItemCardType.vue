<script setup lang="ts">
// The type line under the name (`subtitle`), such as "Tower · Level 2".
import type { TooltipContent } from "@tavora/sdk"

defineProps<{ content: TooltipContent }>()
</script>

<template>
  <p v-if="content.subtitle" class="tavora-item-card-type">{{ content.subtitle }}</p>
</template>
