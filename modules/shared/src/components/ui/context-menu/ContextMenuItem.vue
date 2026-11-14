<script setup lang="ts">
import type { ContextMenuItemEmits, ContextMenuItemProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  ContextMenuItem,
  injectContextMenuRootContext,
  useForwardPropsEmits,
} from "reka-ui"
import { mergeProps, ref } from "vue"
import { useMenuAction, type MenuAction } from "../../../lib/menu-action"
import { ACTIVATE_KEYS, useAriaDisabled, useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<ContextMenuItemProps & {
  /**
   * Why it is off. With `disabled` the row stays reachable by hover and the arrow keys, shows the reason beside it
   * and can't be chosen. Without a reason a disabled row is skipped, as before.
   */
  disabledReason?: string
  /**
   * What choosing the row runs, instead of `@select`. When it returns a Promise the menu stays open with the row busy
   * until it settles (it can't be chosen again meanwhile), then closes; a failure shows a toast. Only for work that
   * runs by itself: an action that opens a dialog or picker uses `@select`.
   */
  action?: MenuAction
  class?: HTMLAttributes["class"]
  inset?: boolean
  variant?: "default" | "destructive"
}>(), {
  variant: "default",
})
const emits = defineEmits<ContextMenuItemEmits>()

const delegatedProps = reactiveOmit(props, "class", "disabledReason", "action")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
// Reka skips rows marked `data-disabled`, so a row with a reason is not marked: it is `aria-disabled` and ignores a click or Enter / Space.
const soft = useSoftDisabled(() => ({ disabled: props.disabled, reason: props.disabledReason }), { keys: ACTIVATE_KEYS, dataDisabled: false, side: "right" })
// Reka writes `aria-disabled` itself (and would blank ours), so it is set on the row's element.
const item = ref<{ $el?: unknown } | null>(null)
useAriaDisabled(() => item.value, soft.soft)
const root = injectContextMenuRootContext(null)
const menu = useMenuAction(() => props.action, () => root?.onOpenChange(false))
</script>

<template>
  <ContextMenuItem
    ref="item"
    data-slot="context-menu-item"
    :data-inset="inset ? '' : undefined"
    :data-variant="variant"
    v-bind="mergeProps(forwarded, soft.attrs(), action ? { onSelect: menu.select } : {})"
    :disabled="soft.disabled()"
    :aria-busy="menu.busy.value || undefined"
    :class="cn(
      `focus:bg-[color-mix(in_srgb,var(--foreground)_5%,var(--accent))] focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground focus:[&_svg:not([class*='text-'])]:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 data-[inset]:pl-8 tavora-busy aria-busy:cursor-progress aria-busy:bg-[color-mix(in_srgb,var(--foreground)_5%,var(--accent))] data-[variant=destructive]:aria-busy:bg-destructive/10 dark:data-[variant=destructive]:aria-busy:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
      props.class,
    )"
  >
    <slot />
  </ContextMenuItem>
</template>
