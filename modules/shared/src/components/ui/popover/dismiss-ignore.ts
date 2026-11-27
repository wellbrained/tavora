import type { ComponentPublicInstance, MaybeRefOrGetter } from "vue"
import { toValue } from "vue"

type Ignorable = string | Element | ComponentPublicInstance | null | undefined

/**
 * Where a pointer press or a focus move leaves a popover open: an element, a component (a template ref), a CSS selector
 * for the closest match (`"[data-keep-open]"`), a getter of those (a ref's `.value` in a template is already one), or a list
 * of them.
 */
export type DismissIgnore = MaybeRefOrGetter<Ignorable | readonly Ignorable[]>

/** True when `target` is inside one of the ignored places. */
export function isDismissIgnored(target: EventTarget | null | undefined, ignore: DismissIgnore | undefined): boolean {
  if (!(target instanceof Node) || ignore == null) return false
  const value = toValue(ignore)
  const list: readonly Ignorable[] = Array.isArray(value) ? value : [value as Ignorable]
  return list.some((item) => {
    if (!item) return false
    if (typeof item === "string") return target instanceof Element && target.closest(item) !== null
    const element = item instanceof Element ? item : (item as ComponentPublicInstance).$el
    return element instanceof Node && element.contains(target)
  })
}
