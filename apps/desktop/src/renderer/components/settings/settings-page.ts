// What the Settings page tells the groups on it: its title, so a group whose
// title only repeats it can leave its own out.
import type { ComputedRef, InjectionKey } from "vue";

export const SETTINGS_PAGE_TITLE: InjectionKey<ComputedRef<string>> = Symbol("settings-page-title");
