// What a Whiteboard panel remembers for itself. A newer version of the module may keep more there (the catalogue's copy, before a
// fallback to the shipped one): it is read aside and put back on every save, so this version's save doesn't erase it.
import { unknownFields } from "@tavora/official-ui/lib/utils";
import type { JsonValue } from "@tavora/sdk";

export const PANEL_STATE_KEYS = ["selected", "views", "palette"] as const;

/** What a newer version kept in the panel's state besides this version's keys. */
export const otherPanelState = (state: unknown): Record<string, JsonValue> => unknownFields<JsonValue>(state, PANEL_STATE_KEYS);

/** The panel's state to save: this version's keys over what a newer one kept. */
export const panelStateToSave = (other: Record<string, JsonValue>, own: Record<(typeof PANEL_STATE_KEYS)[number], unknown>): Record<string, unknown> => ({ ...other, ...own });
