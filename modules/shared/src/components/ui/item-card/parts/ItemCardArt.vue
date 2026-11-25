<script setup lang="ts">
// The card's picture, large, with its tags over the bottom corners (`artTags`): a row in each corner that has one
// ("right" when a tag doesn't say). A tag's colour is "#rrggbb" only, as in the shared tooltip.
import type { TooltipContent } from "@tavora/sdk"
import { computed } from "vue"

const props = defineProps<{ content: TooltipContent }>()
const HEX = /^#[0-9a-fA-F]{6}$/
const rows = computed(() =>
  (["left", "right"] as const)
    .map((side) => ({ side, tags: (props.content.artTags ?? []).filter((tag) => (tag.side === "left" ? "left" : "right") === side) }))
    .filter((row) => row.tags.length),
)
const tagStyle = (color: string | undefined) => (color && HEX.test(color) ? { color, borderColor: color } : undefined)
</script>

<template>
  <div v-if="content.image" class="tavora-item-card-art">
    <img :src="content.image" alt="" />
    <div v-if="rows.length" class="tavora-item-card-art-tags">
      <div v-for="row in rows" :key="row.side" :data-side="row.side">
        <span v-for="(tag, i) in row.tags" :key="i" class="tavora-item-card-art-tag" :style="tagStyle(tag.color)">{{ tag.text }}</span>
      </div>
    </div>
  </div>
</template>
