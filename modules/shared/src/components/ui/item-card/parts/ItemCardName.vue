<script setup lang="ts">
// The card's name row: the title, its badges at the right. Without a picture the tags' texts follow the badges.
import type { TooltipContent } from "@tavora/sdk"
import { computed } from "vue"
import { tagBadges } from "../content"

const props = defineProps<{ content: TooltipContent }>()
const badges = computed(() => (props.content.image ? (props.content.badges ?? []) : tagBadges(props.content)))
</script>

<template>
  <div class="tavora-item-card-name">
    <h3>{{ content.title }}</h3>
    <div v-if="badges.length" class="tavora-item-card-badges">
      <span v-for="(badge, i) in badges" :key="i" class="tavora-item-card-badge">{{ badge }}</span>
    </div>
  </div>
</template>
