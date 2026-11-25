import type { Component } from "vue"

/**
 * One entry of a TreeView. An entry with `children` is a branch (an empty array too); without, a leaf.
 * Extend it for data of your own (`interface Step extends TreeNode { rate: number; children?: Step[] }`): the `row` slot
 * gets your type back.
 */
export interface TreeNode {
  /** Unique in the whole tree. `v-model`, `v-model:expanded` and `select` use it. */
  id: string
  /** What the row shows and what typing a letter jumps to. Give it even when the `row` slot draws the row. */
  label: string
  children?: TreeNode[]
  icon?: Component
  /** A small number or word at the end, such as a count. */
  badge?: string | number
  /** Can't be picked, opened or reached with the arrow keys. */
  disabled?: boolean
}

/** What the `row` slot gets for each row. */
export interface TreeRowProps<T extends TreeNode = TreeNode> {
  item: T
  /** 1 for the top entries. */
  level: number
  branch: boolean
  expanded: boolean
  selected: boolean
}
