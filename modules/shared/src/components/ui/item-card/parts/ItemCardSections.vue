<script setup lang="ts">
// The card's sections (`sections`): an optional heading, then rows of a text with a bullet before it and its status and
// badges after it (a PoE item's affix tags), as the shared tooltip draws them. A `connected` row has a line instead of
// the bullet.
import type { TooltipContent } from "@tavora/sdk"

defineProps<{ content: TooltipContent }>()
</script>

<template>
  <section v-for="(s, i) in content.sections ?? []" :key="i" class="tavora-item-card-section">
    <p v-if="s.title">{{ s.title }}</p>
    <ul>
      <li v-for="(r, j) in s.rows" :key="j" :data-connected="r.connected ? '' : undefined"><span>{{ r.text }}</span><span v-if="r.status || r.badges?.length" class="tavora-item-card-affixes"><small v-if="r.status">{{ r.status }}</small><span v-for="(b, k) in r.badges ?? []" :key="k">{{ b }}</span></span></li>
    </ul>
  </section>
</template>
