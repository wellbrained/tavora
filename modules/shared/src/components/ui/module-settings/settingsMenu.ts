// The menu of a module's settings, in the order every module has it: its own pages first, without a heading; then Overlays under a
// divider heading, first how the overlay looks (Text, Look: the module's own pages, shared by game and stream), then where it
// shows: In game and On stream, each with a dot (green filled: on, hollow: off).
import { Cast, Gamepad2 } from "@lucide/vue";
import type { NavGroup, NavItem } from "../nav-list";
import { uiText } from "../text";

export interface OverlayPlace {
  /** The page's id. */
  id: string;
  /** Whether the overlay shows there now. */
  on: boolean;
  testid?: string;
}

export interface SettingsMenu {
  /** The module's own pages, such as a clock's settings and Hotkeys. */
  pages: NavItem[];
  /** How the overlay looks, first in Overlays: usually Text (lucide `Type`) and Look (`Paintbrush`). */
  look?: NavItem[];
  /** The page for the overlay over the game; leave it out when the module has none. */
  inGame?: OverlayPlace;
  /** The page for the overlay on stream (an OBS link, say); leave it out when the module has none. */
  onStream?: OverlayPlace;
}

/** The groups for `ModuleSettings`. Labels, icons and the dot's words come from the kit, so every module reads the same. */
export function settingsMenu(menu: SettingsMenu): NavGroup[] {
  const place = (place: OverlayPlace, label: string, icon: NavItem["icon"]): NavItem => ({
    id: place.id,
    label,
    icon,
    testid: place.testid,
    status: place.on ? "on" : "off",
    statusLabel: place.on ? uiText.value.statusOn : uiText.value.statusOff,
  });
  const overlays: NavItem[] = [...(menu.look ?? []), ...(menu.inGame ? [place(menu.inGame, uiText.value.inGame, Gamepad2)] : []), ...(menu.onStream ? [place(menu.onStream, uiText.value.onStream, Cast)] : [])];
  return [{ items: menu.pages }, ...(overlays.length ? [{ heading: uiText.value.overlays, divider: true, items: overlays }] : [])];
}
