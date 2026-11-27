<script setup lang="ts">
// The parts after the sections (`blocks`): paragraphs, headings, lists and tags, drawn by the kit's tooltip parts
// (TooltipText, TooltipHeading, TooltipList, TooltipTags), as the shared tooltip draws them. A part of a kind this kit
// doesn't know is left out.
import type { TooltipContent } from "@tavora/sdk"
import { TooltipHeading, TooltipList, TooltipTags, TooltipText } from "../../../tooltip/parts"

defineProps<{ content: TooltipContent }>()
</script>

<template>
  <template v-for="(block, i) in content.blocks ?? []" :key="i">
    <TooltipText v-if="block.type === 'text'" :text="block.text" :runs="block.runs" :tone="block.tone" :size="block.size" :box="block.box" />
    <TooltipHeading v-else-if="block.type === 'heading'" :text="block.text" />
    <TooltipList v-else-if="block.type === 'list'" :items="block.items" />
    <TooltipTags v-else-if="block.type === 'tags'" :tags="block.tags" />
  </template>
</template>
