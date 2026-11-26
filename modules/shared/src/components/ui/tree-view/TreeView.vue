<script setup lang="ts" generic="T extends TreeNode">
// A tree of entries whose branches open and close: a document's outline, a production chain, folders.
// One tab stop (the picked row, else the first); up and down move between visible rows, right opens a branch or goes
// into it, left closes it or goes to its parent, Home and End jump to the first and last row, `*` opens every branch
// beside this one, and typing a letter jumps to the next row starting with it (reka's Tree does the keys).
//
// `selection="single"` (default): a press on a row picks it (`v-model`, the id); the chevron opens and closes a branch.
// `selection="none"`: nothing is picked (no `aria-selected`), a press on a branch opens or closes it. Both send `select`
// on every press of a row (not of its chevron), also on the row that is already picked, so a row can open its page again.
// `v-model:expanded` holds the open branches (save it with the panel if it should stay); `default-expanded="all"` starts
// with everything open (read once, when the tree is made). Hand it a new array to change it, not one changed in place. Opening or closing many at once (expandAll, collapseAll) happens without motion.
// The `row` slot draws a row's content after the chevron (`item`, `level`, `branch`, `expanded`, `selected`); the tree
// keeps the indent, the chevron, the guides, the hover and the focus. A button inside a row stops its click
// (`@click.stop`), or the press also picks the row.
import { TreeRoot } from "reka-ui"
import { computed, provide, ref, useSlots, watch, type HTMLAttributes, type Slot } from "vue"
import { cn } from "../../../lib/utils"
import { TREE, type TreeItemEvent } from "./context"
import { expandAll } from "./helpers"
import TreeLevel from "./TreeLevel.vue"
import type { TreeNode, TreeRowProps } from "./types"

const props = withDefaults(
  defineProps<{
    items: T[]
    /** Names the tree for screen readers. */
    label: string
    modelValue?: string | null
    expanded?: string[]
    defaultExpanded?: string[] | "all"
    selection?: "single" | "none"
    /** Thin lines under each open branch, down to its last child. */
    guides?: boolean
    /** Row height on the kit's size scale: `default` (the control height) or `sm` (4px less) for a dense tree. */
    size?: "sm" | "default"
    class?: HTMLAttributes["class"]
  }>(),
  { modelValue: undefined, expanded: undefined, defaultExpanded: undefined, selection: "single", guides: true, size: "default" },
)
const emit = defineEmits<{
  "update:modelValue": [id: string]
  "update:expanded": [ids: string[]]
  /** Every press on a row (click, Enter, Space; not on its chevron), also on the row that is already picked. */
  select: [id: string]
}>()
defineSlots<{ row?: (props: TreeRowProps<T>) => unknown }>()
const slots = useSlots()

const picked = ref<string | null>(props.modelValue ?? null)
watch(
  () => props.modelValue,
  (id) => (picked.value = id ?? null),
)

const open = ref<string[]>(props.expanded ?? (props.defaultExpanded === "all" ? expandAll(props.items) : (props.defaultExpanded ?? [])))
watch(
  () => props.expanded,
  (ids) => {
    if (ids) open.value = ids
  },
)

// More than one branch changing at once (open all, close all, `*`) skips the motion for that change.
const instant = ref(false)
watch(open, (next, before) => {
  const changed = next.filter((id) => !before.includes(id)).length + before.filter((id) => !next.includes(id)).length
  if (changed < 2) return
  instant.value = true
  requestAnimationFrame(() => requestAnimationFrame(() => (instant.value = false)))
})

function setOpen(ids: string[]) {
  open.value = ids
  emit("update:expanded", ids)
}

/** Every entry by id, with the list it sits in (for `*`). */
const entries = computed(() => {
  const map = new Map<string, { node: TreeNode; siblings: TreeNode[] }>()
  const walk = (nodes: TreeNode[]) =>
    nodes.forEach((node) => {
      map.set(node.id, { node, siblings: nodes })
      if (node.children) walk(node.children)
    })
  walk(props.items)
  return map
})
const pickedNode = computed(() => (picked.value ? entries.value.get(picked.value)?.node : undefined))

const onChevron = (event: Event) => event.type === "click" && !!(event.target as Element | null)?.closest?.("[data-tree-chevron]")

provide(TREE, {
  guides: () => props.guides,
  size: () => props.size,
  picks: () => props.selection === "single",
  isOpen: (id) => open.value.includes(id),
  isPicked: (id) => props.selection === "single" && picked.value === id,
  row: () => slots.row as Slot<TreeRowProps> | undefined,
  onSelect(event: TreeItemEvent, node: TreeNode) {
    // The tree picks by itself: reka would pick the row's object and drop the pick on a second press.
    event.preventDefault()
    const cause = event.detail.originalEvent
    if (onChevron(cause)) return
    emit("select", node.id)
    if (props.selection === "single") {
      picked.value = node.id
      emit("update:modelValue", node.id)
    } else if (node.children && cause.type === "keydown") {
      // Enter or Space on a branch of a tree that picks nothing opens or closes it, as a press does.
      setOpen(open.value.includes(node.id) ? open.value.filter((id) => id !== node.id) : [...open.value, node.id])
    }
  },
  onToggle(event: TreeItemEvent) {
    // Arrow keys open and close as reka does; a press opens and closes only on the chevron, or in a tree that picks nothing.
    const cause = event.detail.originalEvent
    if (cause.type === "keydown" || props.selection === "none" || onChevron(cause)) return
    event.preventDefault()
  },
})

/** `*` opens every branch beside the focused row. */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "*" || event.ctrlKey || event.metaKey || event.altKey) return
  // Only on the row itself: a field or button inside a row keeps its own keys.
  const row = event.target as HTMLElement | null
  if (!row?.hasAttribute?.("data-tree-id")) return
  const id = row.dataset.treeId
  const entry = id ? entries.value.get(id) : undefined
  if (!entry) return
  event.preventDefault()
  const branches = entry.siblings.filter((node) => node.children && !node.disabled).map((node) => node.id)
  setOpen([...new Set([...open.value, ...branches])])
}
</script>

<template>
  <TreeRoot
    :items="items"
    :get-key="(node: TreeNode) => node.id"
    :expanded="open"
    :model-value="selection === 'single' ? pickedNode : undefined"
    as="div"
    data-slot="tree-view"
    :aria-label="label"
    :data-tree-instant="instant ? '' : undefined"
    :class="cn('flex flex-col gap-0.5 outline-none', props.class)"
    @update:expanded="setOpen"
    @keydown="onKeydown"
  >
    <TreeLevel :nodes="items" :level="1" />
  </TreeRoot>
</template>
