import type { InjectionKey, Ref } from "vue"

/** TabsList tells its tabs whether it draws the selected line itself (true) or each tab does (false). */
export const tabsIndicatorKey: InjectionKey<Ref<boolean>> = Symbol("tabsIndicator")
