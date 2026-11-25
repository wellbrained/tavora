<script setup lang="ts">
// The rows of one level of a TreeView. A branch is a Collapsible: its row, then its children in a group that grows open
// and shuts (motion.css, .tavora-collapse), with a thin guide line under its chevron.
import { inject } from "vue"
import { cn } from "../../../lib/utils"
import { Collapsible, CollapsibleContent } from "../collapsible"
import { TREE, guideX } from "./context"
import TreeRow from "./TreeRow.vue"
import type { TreeNode } from "./types"

defineOptions({ name: "TreeLevel" })
defineProps<{ nodes: TreeNode[]; level: number }>()
const tree = inject(TREE)!
</script>

<template>
  <template v-for="(node, index) in nodes" :key="node.id">
    <Collapsible v-if="node.children" :open="tree.isOpen(node.id)" class="flex flex-col">
      <TreeRow :node="node" :level="level" :index="index" :count="nodes.length" />
      <!-- The 2px above the first child is padding, not a gap: it grows and shuts with the group. -->
      <CollapsibleContent
        role="group"
        :style="{ '--tree-guide': `${guideX(level)}px` }"
        :class="cn('relative flex flex-col gap-0.5 pt-0.5', tree.guides() && 'before:bg-border before:absolute before:top-0.5 before:bottom-0 before:start-(--tree-guide) before:w-px')"
      >
        <TreeLevel :nodes="node.children" :level="level + 1" />
      </CollapsibleContent>
    </Collapsible>
    <TreeRow v-else :node="node" :level="level" :index="index" :count="nodes.length" />
  </template>
</template>
