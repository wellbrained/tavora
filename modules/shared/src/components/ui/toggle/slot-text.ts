import { Comment, Fragment, Text, type VNode, type VNodeArrayChildren } from "vue"

/**
 * The text a slot shows, read from its nodes as it renders: text nodes and the text of plain elements count, icons
 * (components and `svg`) and comments don't. A toggle uses it to tell an icon-only one (square, its label as the tooltip)
 * from one with words. A component's own text can't be seen from here, so it counts as an icon.
 */
export function slotText(nodes: VNodeArrayChildren | undefined | null): string {
  let text = ""
  for (const node of nodes ?? []) {
    if (node == null || typeof node === "boolean") continue
    if (typeof node === "string" || typeof node === "number") {
      text += String(node)
      continue
    }
    if (Array.isArray(node)) {
      text += slotText(node)
      continue
    }
    const vnode = node as VNode
    if (vnode.type === Comment) continue
    if (vnode.type === Text) {
      text += String(vnode.children ?? "")
      continue
    }
    if (vnode.type === Fragment || (typeof vnode.type === "string" && vnode.type !== "svg")) {
      if (typeof vnode.children === "string") text += vnode.children
      else if (Array.isArray(vnode.children)) text += slotText(vnode.children)
    }
  }
  return text
}
