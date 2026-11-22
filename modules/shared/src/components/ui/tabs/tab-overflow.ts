// How the user reaches tabs that don't fit a row (Settings > Appearance > Too many tabs): a list of them or arrows.
// It comes with the theme (`theme.tabOverflow`), so every TabStrip in the page follows it, as Tavora's own panel tabs do.
// The app's renderer uses the kit without the SDK's build, so the type is written here as the toasts' position is: it
// matches the SDK's `TabOverflow`.
import { readonly, ref } from "vue";

/** A list button with the hidden tabs' count, or arrows that step through the tabs. */
export type TabOverflow = "list" | "arrows";

const current = ref<TabOverflow>("list");

/** The user's choice; the list until a theme says otherwise (an older Tavora never does). */
export const tabOverflow = readonly(current);

/** Called with every theme (`applyKitTheme`). */
export function setTabOverflow(value: TabOverflow): void {
  current.value = value;
}
