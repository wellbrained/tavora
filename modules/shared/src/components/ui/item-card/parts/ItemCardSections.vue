<script setup lang="ts">
// The card's sections (`sections`): an optional heading, then rows of a text with a status and badges after it.
import type { TooltipContent } from "@tavora/sdk"

defineProps<{ content: TooltipContent }>()
</script>

<template>
  <section v-for="(s, i) in content.sections ?? []" :key="i" class="tavora-item-card-section">
    <p v-if="s.title">{{ s.title }}</p>
    <ul>
      <li v-for="(r, j) in s.rows" :key="j" :data-connected="r.connected ? '' : undefined"><span>{{ r.text }}</span><span v-if="r.status || r.badges?.length">{{ [r.status, ...(r.badges ?? [])].filter(Boolean).join(" ") }}</span></li>
    </ul>
  </section>
</template>
