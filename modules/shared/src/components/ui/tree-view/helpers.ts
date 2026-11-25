import type { TreeNode } from "./types"

/** The ids of every branch in the tree: pass it to `v-model:expanded` to open everything. */
export function expandAll(items: readonly TreeNode[]): string[] {
  return items.flatMap((item) => (item.children ? [item.id, ...expandAll(item.children)] : []))
}

/** Nothing open: pass it to `v-model:expanded` to close everything. */
export function collapseAll(): string[] {
  return []
}
