import type { InjectionKey, Slot } from "vue"
import type { TreeNode, TreeRowProps } from "./types"

/** reka's select and toggle events: a custom event that carries the click or key that caused it. */
export type TreeItemEvent = CustomEvent<{ originalEvent: Event }>

export interface TreeContext {
  guides: () => boolean
  /** Whether the tree picks a row at all (`selection="single"`). */
  picks: () => boolean
  isOpen: (id: string) => boolean
  isPicked: (id: string) => boolean
  row: () => Slot<TreeRowProps> | undefined
  onSelect: (event: TreeItemEvent, node: TreeNode) => void
  onToggle: (event: TreeItemEvent, node: TreeNode) => void
}

export const TREE: InjectionKey<TreeContext> = Symbol("tree-view")

/** Left padding of a row: the chevron of each level sits under the label of the one above. */
export const indent = (level: number) => 8 + (level - 1) * 16

/** Where a branch's guide line runs: through the middle of its chevron. */
export const guideX = (level: number) => indent(level) + 7.5
