<script setup lang="ts">
// The contents list of a PDF: entries that open their page, with the ones below them indented.
import type { OutlineNode } from "./pdf";

defineProps<{ nodes: OutlineNode[]; depth?: number }>();
const emit = defineEmits<{ go: [page: number] }>();
</script>

<template>
  <ul class="flex flex-col" :role="depth ? 'group' : 'tree'">
    <li v-for="(node, index) in nodes" :key="index" role="treeitem">
      <button
        type="button"
        class="hover:bg-accent disabled:text-muted-foreground block w-full truncate rounded-md py-1 pr-2 text-left text-sm disabled:cursor-default disabled:hover:bg-transparent"
        :style="{ paddingLeft: `${8 + (depth ?? 0) * 12}px` }"
        :disabled="node.page === null"
        :title="node.title"
        data-testid="outline-item"
        @click="node.page !== null && emit('go', node.page)"
      >
        {{ node.title }}
      </button>
      <OutlineList v-if="node.items.length" :nodes="node.items" :depth="(depth ?? 0) + 1" @go="emit('go', $event)" />
    </li>
  </ul>
</template>
