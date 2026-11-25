import { inject, type InjectionKey } from "vue"
import type { UseHoverCard } from "./use-hover-card"

export const hoverCardKey: InjectionKey<UseHoverCard<unknown>> = Symbol("HoverCard")

export function injectHoverCard(part: string): UseHoverCard<unknown> {
  const controller = inject(hoverCardKey, null)
  if (!controller) throw new Error(`${part} must be inside a HoverCard`)
  return controller
}
