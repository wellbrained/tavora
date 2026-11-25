<script setup lang="ts">
// One row of a TreeView: the chevron (a branch) or its space (a leaf), then the row's content: icon, label and badge, or
// the tree's `row` slot. The row is the treeitem; reka moves the focus between rows and reports presses (TreeView decides
// what a press does).
import { ChevronRight } from "@lucide/vue"
import { TreeItem } from "reka-ui"
import { inject, type Directive, type FunctionalComponent } from "vue"
import { cn } from "../../../lib/utils"
import { TREE, indent } from "./context"
import type { TreeNode, TreeRowProps } from "./types"

const props = defineProps<{ node: TreeNode; level: number; index: number; count: number }>()
const tree = inject(TREE)!

/**
 * reka writes `aria-selected="false"` on every row; a tree that picks nothing says nothing about it. Vue only writes the
 * attribute again when its value changes, which it can't there, so taking it off once stays.
 */
const vNoSelection: Directive<HTMLElement, boolean> = {
  mounted: (el, { value }) => value && el.removeAttribute("aria-selected"),
  updated: (el, { value }) => value && el.removeAttribute("aria-selected"),
}

/** The tree's `row` slot, drawn here. */
const RowSlot: FunctionalComponent<TreeRowProps> = (rowProps) => tree.row()?.(rowProps)
</script>

<template>
  <TreeItem
    v-slot="{ isExpanded }"
    v-no-selection="!tree.picks()"
    :value="node"
    :level="level"
    :disabled="node.disabled"
    as="div"
    data-slot="tree-row"
    :data-tree-id="node.id"
    :data-active="tree.isPicked(node.id) ? '' : undefined"
    :aria-setsize="count"
    :aria-posinset="index + 1"
    :style="{ paddingInlineStart: `${indent(level)}px` }"
    :class="
      cn(
        'text-muted-foreground flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded-md pe-2 text-sm font-medium outline-none select-none transition-colors duration-(--duration-press) ease-(--ease-out-strong) focus-visible:inset-ring-2 focus-visible:inset-ring-ring',
        node.disabled ? 'cursor-default opacity-(--disabled-opacity)' : 'hover:text-foreground cursor-pointer hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))]',
        tree.isPicked(node.id) && 'bg-primary/10 text-foreground hover:bg-primary/15',
      )
    "
    @select="tree.onSelect($event, node)"
    @toggle="tree.onToggle($event, node)"
  >
    <span v-if="node.children" data-tree-chevron class="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
      <ChevronRight :class="cn('size-4 transition-transform duration-(--duration-press) ease-(--ease-out-strong) rtl:-scale-x-100', isExpanded && 'rotate-90 rtl:-rotate-90')" />
    </span>
    <span v-else class="size-4 shrink-0" aria-hidden="true" />
    <RowSlot v-if="tree.row()" :item="node" :level="level" :branch="!!node.children" :expanded="isExpanded" :selected="tree.isPicked(node.id)" />
    <template v-else>
      <component :is="node.icon" v-if="node.icon" :class="cn('size-4 shrink-0', tree.isPicked(node.id) && 'text-primary')" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">{{ node.label }}</span>
      <span v-if="node.badge !== undefined" :class="cn('text-xs tabular-nums', tree.isPicked(node.id) ? 'text-primary' : 'text-muted-foreground')">{{ node.badge }}</span>
    </template>
  </TreeItem>
</template>
